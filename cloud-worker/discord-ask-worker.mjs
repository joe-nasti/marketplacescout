// Discord transport for Ask Collectish.
//
// Runtime: Cloudflare Worker with a Queue producer/consumer and KV binding.
// Discord ingress is deliberately stateless: verify -> enqueue -> deferred response.
// The queue consumer refreshes a user-scoped Supabase OAuth token, calls the stable
// ask-collectish-api facade, and edits Discord's original deferred response.
//
// Required secrets/vars:
//   DISCORD_PUBLIC_KEY                 Discord application public key (hex)
//   DISCORD_APPLICATION_ID             Discord application id
//   SUPABASE_URL                       https://<project-ref>.supabase.co
//   SUPABASE_ANON_KEY                  public anon/publishable key
//   SUPABASE_SERVICE_ROLE_KEY          integration-table access only
//   COLLECTISH_OAUTH_CLIENT_ID         Supabase OAuth Server confidential client id
//   COLLECTISH_OAUTH_CLIENT_SECRET     Supabase OAuth Server client secret
//   COLLECTISH_OAUTH_REDIRECT_URI      <worker>/discord/oauth/callback
//   DISCORD_TOKEN_ENCRYPTION_KEY       base64-encoded 32-byte AES-256 key
//   DISCORD_LINK_TICKET_SECRET         random HMAC secret
//   DISCORD_WORKER_BASE_URL            public worker origin
// Bindings:
//   DISCORD_ASK_QUEUE                  Cloudflare Queue
//   DISCORD_LINK_STATE                 Cloudflare KV namespace

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DISCORD_API = 'https://discord.com/api/v10';
const EPHEMERAL = 1 << 6;
const MAX_DISCORD_CONTENT = 1950;

const clean = (value, max = 2000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});

function bytesToBase64(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) binary += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function base64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64url(value) {
  let text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  return base64ToBytes(text);
}
function hexToBytes(hex) {
  const value = String(hex || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('DISCORD_PUBLIC_KEY must be 32-byte hex');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function verifyDiscordRequest(request, rawBody, publicKeyHex) {
  const signatureHex = request.headers.get('x-signature-ed25519') || '';
  const timestamp = request.headers.get('x-signature-timestamp') || '';
  if (!/^[0-9a-f]{128}$/i.test(signatureHex) || !timestamp) return false;
  const signature = hexToBytes(signatureHex);
  const publicKey = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    signature,
    encoder.encode(timestamp + rawBody),
  );
}

async function sha256Base64url(value) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
function randomToken(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return base64url(array);
}

async function hmac(env, payload) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.DISCORD_LINK_TICKET_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}
async function makeLinkTicket(env, user) {
  const payload = base64url(encoder.encode(JSON.stringify({
    discord_user_id: user.id,
    discord_username: clean(user.username, 80),
    discord_global_name: clean(user.global_name, 120),
    exp: Date.now() + 15 * 60 * 1000,
  })));
  return `${payload}.${await hmac(env, payload)}`;
}
async function verifyLinkTicket(env, ticket) {
  const [payload, signature] = String(ticket || '').split('.');
  if (!payload || !signature) return null;
  const expected = await hmac(env, payload);
  if (expected !== signature) return null;
  let parsed;
  try { parsed = JSON.parse(decoder.decode(fromBase64url(payload))); } catch { return null; }
  if (!parsed?.discord_user_id || Number(parsed.exp || 0) < Date.now()) return null;
  return parsed;
}

async function aesKey(env) {
  const raw = base64ToBytes(env.DISCORD_TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error('DISCORD_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encryptRefreshToken(env, token) {
  const iv = new Uint8Array(12); crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), encoder.encode(token));
  return { ciphertext: bytesToBase64(cipher), iv: bytesToBase64(iv) };
}
async function decryptRefreshToken(env, ciphertext, iv) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    await aesKey(env),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(plain);
}

function supabaseBase(env) { return String(env.SUPABASE_URL || '').replace(/\/$/, ''); }
function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}
async function serviceRest(env, path, init = {}) {
  const response = await fetch(`${supabaseBase(env)}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: serviceHeaders(env, init.prefer ? { Prefer: init.prefer } : {}),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `Supabase REST ${response.status}`);
  return data;
}

async function claimDelivery(env, job) {
  const rows = await serviceRest(env, 'rpc/claim_discord_ask_delivery', {
    method: 'POST',
    body: { p_interaction_id: job.interaction_id, p_discord_user_id: job.discord_user_id },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}
async function updateDelivery(env, interactionId, patch) {
  return serviceRest(env, `discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(interactionId)}`, {
    method: 'PATCH', body: { ...patch, updated_at: nowIso() },
  });
}
async function linkForDiscord(env, discordUserId) {
  const rows = await serviceRest(env,
    `discord_collectish_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=id,user_id,discord_user_id&limit=1`);
  return rows?.[0] || null;
}
async function credentialForLink(env, linkId) {
  const rows = await serviceRest(env,
    `discord_collectish_oauth_credentials?link_id=eq.${encodeURIComponent(linkId)}&select=link_id,refresh_token_ciphertext,refresh_token_iv,oauth_client_id&limit=1`);
  return rows?.[0] || null;
}
async function bindingForJob(env, linkId, job) {
  const threadFilter = job.thread_id ? `thread_id=eq.${encodeURIComponent(job.thread_id)}` : 'thread_id=is.null';
  const rows = await serviceRest(env,
    `discord_ask_bindings?link_id=eq.${encodeURIComponent(linkId)}&channel_id=eq.${encodeURIComponent(job.channel_id)}&${threadFilter}&select=id,ask_session_id&limit=1`);
  return rows?.[0] || null;
}
async function saveBinding(env, linkId, job, sessionId) {
  const existing = await bindingForJob(env, linkId, job);
  const body = {
    ask_session_id: sessionId || null,
    last_interaction_id: job.interaction_id,
    guild_id: job.guild_id || null,
    updated_at: nowIso(),
  };
  if (existing?.id) {
    await serviceRest(env, `discord_ask_bindings?id=eq.${encodeURIComponent(existing.id)}`, { method: 'PATCH', body });
    return existing.id;
  }
  const rows = await serviceRest(env, 'discord_ask_bindings', {
    method: 'POST', prefer: 'return=representation',
    body: [{
      link_id: linkId,
      guild_id: job.guild_id || null,
      channel_id: job.channel_id,
      thread_id: job.thread_id || null,
      ask_session_id: sessionId || null,
      last_interaction_id: job.interaction_id,
    }],
  });
  return rows?.[0]?.id || null;
}

function oauthBasic(env) {
  return `Basic ${btoa(`${env.COLLECTISH_OAUTH_CLIENT_ID}:${env.COLLECTISH_OAUTH_CLIENT_SECRET}`)}`;
}
async function oauthTokenRequest(env, params) {
  const response = await fetch(`${supabaseBase(env)}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: oauthBasic(env),
    },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) throw new Error(data?.error_description || data?.error || `OAuth token HTTP ${response.status}`);
  return data;
}
async function refreshUserAccessToken(env, linkId) {
  const credential = await credentialForLink(env, linkId);
  if (!credential) throw new Error('Discord OAuth credential is missing; relink Collectish');
  if (credential.oauth_client_id !== env.COLLECTISH_OAUTH_CLIENT_ID) throw new Error('Discord OAuth client mismatch; relink Collectish');
  const refreshToken = await decryptRefreshToken(env, credential.refresh_token_ciphertext, credential.refresh_token_iv);
  const tokens = await oauthTokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    const encrypted = await encryptRefreshToken(env, tokens.refresh_token);
    await serviceRest(env, `discord_collectish_oauth_credentials?link_id=eq.${encodeURIComponent(linkId)}`, {
      method: 'PATCH',
      body: {
        refresh_token_ciphertext: encrypted.ciphertext,
        refresh_token_iv: encrypted.iv,
        rotated_at: nowIso(),
      },
    });
  }
  return tokens.access_token;
}

async function callAsk(env, accessToken, job, sessionId) {
  const response = await fetch(`${supabaseBase(env)}/functions/v1/ask-collectish-api`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'chat',
      client: 'discord',
      ...(sessionId ? { session_id: sessionId } : {}),
      message: job.question,
      context: {
        screen: 'discord',
        discord: {
          guild_id: job.guild_id || null,
          channel_id: job.channel_id,
          thread_id: job.thread_id || null,
          interaction_id: job.interaction_id,
        },
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Ask API HTTP ${response.status}`);
  return data;
}

function answerText(data) {
  const value = data?.response ?? data?.answer ?? data?.message ?? 'Ask Collectish completed without a text response.';
  const text = String(value || '').trim();
  return text.length <= MAX_DISCORD_CONTENT ? text : `${text.slice(0, MAX_DISCORD_CONTENT - 18)}\n\n…continued in Collectish`;
}
async function editOriginalDiscord(job, payload) {
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!response.ok) throw new Error(`Discord webhook edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
}

async function processAskJob(env, job) {
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) return;

  // A stale retry may already have the Ask result persisted. Deliver it without
  // invoking Ask a second time.
  if (claim.saved_response_text) {
    await editOriginalDiscord(job, { content: claim.saved_response_text, components: [] });
    await updateDelivery(env, job.interaction_id, { status: 'completed', completed_at: nowIso() });
    return;
  }

  try {
    const link = await linkForDiscord(env, job.discord_user_id);
    if (!link) {
      const ticket = await makeLinkTicket(env, {
        id: job.discord_user_id,
        username: job.discord_username,
        global_name: job.discord_global_name,
      });
      const url = `${String(env.DISCORD_WORKER_BASE_URL).replace(/\/$/, '')}/discord/link/start?ticket=${encodeURIComponent(ticket)}`;
      await editOriginalDiscord(job, {
        content: 'Link your Collectish account to use Ask here. After linking, run `/ask` again.',
        components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Link Collectish', url }] }],
      });
      await updateDelivery(env, job.interaction_id, { status: 'link_required', completed_at: nowIso() });
      return;
    }

    const accessToken = await refreshUserAccessToken(env, link.id);
    const binding = await bindingForJob(env, link.id, job);
    const data = await callAsk(env, accessToken, job, binding?.ask_session_id || null);
    const sessionId = data?.session_id || data?.conversation_id || binding?.ask_session_id || null;
    const content = answerText(data);

    // Persist the result before calling Discord. A webhook failure can then retry
    // delivery without spending another Ask request.
    await updateDelivery(env, job.interaction_id, {
      response_text: content,
      ask_session_id: sessionId,
    });
    if (sessionId) await saveBinding(env, link.id, job, sessionId);

    await editOriginalDiscord(job, { content, components: [] });
    await updateDelivery(env, job.interaction_id, {
      status: 'completed',
      completed_at: nowIso(),
      error_text: null,
    });
  } catch (error) {
    const message = clean(error?.message || error, 500);
    await updateDelivery(env, job.interaction_id, { status: 'failed', error_text: message }).catch(() => null);
    throw error;
  }
}

function discordUser(interaction) {
  return interaction?.member?.user || interaction?.user || null;
}
function commandQuestion(interaction) {
  const options = interaction?.data?.options || [];
  const stack = [...options];
  while (stack.length) {
    const option = stack.shift();
    if (Array.isArray(option?.options)) stack.push(...option.options);
    else if (typeof option?.value === 'string') return clean(option.value, 4000);
  }
  return '';
}
function discordScope(interaction) {
  const channelId = String(interaction?.channel_id || '');
  const parentId = String(interaction?.channel?.parent_id || '');
  return parentId
    ? { channel_id: parentId, thread_id: channelId }
    : { channel_id: channelId, thread_id: null };
}

async function handleInteraction(request, env) {
  const rawBody = await request.text();
  if (!await verifyDiscordRequest(request, rawBody, env.DISCORD_PUBLIC_KEY)) return new Response('invalid request signature', { status: 401 });
  let interaction;
  try { interaction = JSON.parse(rawBody); } catch { return new Response('invalid json', { status: 400 }); }

  if (interaction.type === 1) return json({ type: 1 }); // PING/PONG
  if (interaction.type !== 2) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Unsupported Discord interaction.' } });

  const command = String(interaction?.data?.name || '').toLowerCase();
  if (command !== 'ask') return json({ type: 4, data: { flags: EPHEMERAL, content: 'Use `/ask` to talk to Collectish.' } });

  const user = discordUser(interaction);
  const question = commandQuestion(interaction);
  const scope = discordScope(interaction);
  if (!user?.id || !scope.channel_id) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Discord did not provide enough context for this request.' } });
  if (!question) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Add a question to `/ask`.' } });
  if (!env.DISCORD_ASK_QUEUE?.send) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Ask Collectish Discord queue is not configured.' } });

  await env.DISCORD_ASK_QUEUE.send({
    interaction_id: String(interaction.id),
    interaction_token: String(interaction.token),
    application_id: String(interaction.application_id || env.DISCORD_APPLICATION_ID),
    discord_user_id: String(user.id),
    discord_username: clean(user.username, 80),
    discord_global_name: clean(user.global_name, 120),
    guild_id: interaction.guild_id ? String(interaction.guild_id) : null,
    channel_id: scope.channel_id,
    thread_id: scope.thread_id,
    question,
  });

  // Type 5 acknowledges within Discord's deadline while the queue does the real work.
  return json({ type: 5, data: { flags: EPHEMERAL } });
}

async function handleLinkStart(request, env) {
  const url = new URL(request.url);
  const identity = await verifyLinkTicket(env, url.searchParams.get('ticket'));
  if (!identity) return new Response('This Collectish link has expired. Run /ask in Discord again.', { status: 400 });
  if (!env.DISCORD_LINK_STATE?.put) return new Response('Discord link state is not configured.', { status: 503 });

  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await sha256Base64url(verifier);
  await env.DISCORD_LINK_STATE.put(state, JSON.stringify({ ...identity, code_verifier: verifier }), { expirationTtl: 600 });

  const authorize = new URL(`${supabaseBase(env)}/auth/v1/oauth/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.COLLECTISH_OAUTH_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', env.COLLECTISH_OAUTH_REDIRECT_URI);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('scope', 'openid email profile');
  return Response.redirect(authorize.toString(), 302);
}

async function oauthUser(env, accessToken) {
  const response = await fetch(`${supabaseBase(env)}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error('Could not resolve Collectish OAuth user');
  return data;
}
async function storeOAuthLink(env, identity, userId, refreshToken) {
  const byDiscord = await linkForDiscord(env, identity.discord_user_id);
  const byUserRows = await serviceRest(env,
    `discord_collectish_links?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,discord_user_id&limit=1`);
  const byUser = byUserRows?.[0] || null;
  if (byUser && byUser.discord_user_id !== identity.discord_user_id) {
    throw new Error('This Collectish account is already linked to a different Discord account. Disconnect it in Collectish first.');
  }
  if (byDiscord && byDiscord.user_id !== userId) {
    throw new Error('This Discord account is already linked to a different Collectish account.');
  }

  let link = byDiscord || byUser;
  if (link) {
    await serviceRest(env, `discord_collectish_links?id=eq.${encodeURIComponent(link.id)}`, {
      method: 'PATCH',
      body: {
        discord_username: identity.discord_username || null,
        discord_global_name: identity.discord_global_name || null,
        updated_at: nowIso(),
      },
    });
  } else {
    const rows = await serviceRest(env, 'discord_collectish_links', {
      method: 'POST', prefer: 'return=representation',
      body: [{
        user_id: userId,
        discord_user_id: identity.discord_user_id,
        discord_username: identity.discord_username || null,
        discord_global_name: identity.discord_global_name || null,
      }],
    });
    link = rows?.[0];
  }
  if (!link?.id) throw new Error('Could not persist Discord account link');

  const encrypted = await encryptRefreshToken(env, refreshToken);
  await serviceRest(env, 'discord_collectish_oauth_credentials?on_conflict=link_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: [{
      link_id: link.id,
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
      token_version: 1,
      oauth_client_id: env.COLLECTISH_OAUTH_CLIENT_ID,
      scopes: ['openid', 'email', 'profile'],
      rotated_at: nowIso(),
    }],
  });
  return link;
}

function htmlPage(title, body, status = 200) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;max-width:560px;margin:12vh auto;padding:24px;background:#111;color:#eee}h1{font-size:1.5rem}p{line-height:1.5;color:#bbb}</style><h1>${title}</h1><p>${body}</p>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return htmlPage('Collectish link cancelled', clean(url.searchParams.get('error_description') || error, 300), 400);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const stored = state && env.DISCORD_LINK_STATE?.get ? await env.DISCORD_LINK_STATE.get(state, { type: 'json' }) : null;
  if (!stored?.code_verifier || !code) return htmlPage('Collectish link expired', 'Run /ask in Discord again to start a fresh link.', 400);
  await env.DISCORD_LINK_STATE.delete(state).catch(() => null);

  try {
    const tokens = await oauthTokenRequest(env, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.COLLECTISH_OAUTH_REDIRECT_URI,
      code_verifier: stored.code_verifier,
    });
    if (!tokens.refresh_token) throw new Error('OAuth response did not include a refresh token');
    const user = await oauthUser(env, tokens.access_token);
    await storeOAuthLink(env, stored, user.id, tokens.refresh_token);
    return htmlPage('Collectish linked', 'Your Discord account is linked. Return to Discord and run /ask again.');
  } catch (err) {
    return htmlPage('Collectish link failed', clean(err?.message || err, 400), 400);
  }
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/healthz') return json({ ok: true, service: 'collectish-discord' });
  if (request.method === 'POST' && url.pathname === '/discord/interactions') return handleInteraction(request, env);
  if (request.method === 'GET' && url.pathname === '/discord/link/start') return handleLinkStart(request, env);
  if (request.method === 'GET' && url.pathname === '/discord/oauth/callback') return handleOAuthCallback(request, env);
  return new Response('Not found', { status: 404 });
}

async function handleQueue(batch, env) {
  for (const message of batch.messages) {
    try {
      await processAskJob(env, message.body);
      message.ack();
    } catch (error) {
      console.error('discord ask job failed', { interaction_id: message.body?.interaction_id, error: String(error?.message || error) });
      message.retry({ delaySeconds: Math.min(60, 5 * Math.max(1, Number(message.attempts || 1))) });
    }
  }
}

export {
  answerText,
  commandQuestion,
  discordScope,
  handleFetch,
  handleInteraction,
  handleLinkStart,
  handleOAuthCallback,
  handleQueue,
  processAskJob,
  verifyDiscordRequest,
};

export default { fetch: handleFetch, queue: handleQueue };
