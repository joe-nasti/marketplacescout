import worker, { commandQuestion, discordScope } from './discord-ask-worker.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EPHEMERAL = 1 << 6;
const DISCORD_API = 'https://discord.com/api/v10';
const MAX_DISCORD_CONTENT = 1950;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 2000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function hexToBytes(value, expectedBytes) {
  const hex = String(value || '').trim();
  if (!new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(hex)) return null;
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) binary += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function supabaseBase(env) {
  return String(env.SUPABASE_URL || '').replace(/\/$/, '');
}

async function verifyDiscordRawRequest(request, rawBody, publicKeyHex) {
  const signature = hexToBytes(request.headers.get('x-signature-ed25519'), 64);
  const timestamp = request.headers.get('x-signature-timestamp') || '';
  const publicKeyBytes = hexToBytes(publicKeyHex, 32);
  if (!signature || !timestamp || !publicKeyBytes) return false;

  const timestampBytes = encoder.encode(timestamp);
  const bodyBytes = new Uint8Array(rawBody);
  const signedBytes = new Uint8Array(timestampBytes.length + bodyBytes.length);
  signedBytes.set(timestampBytes, 0);
  signedBytes.set(bodyBytes, timestampBytes.length);

  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyBytes,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, signedBytes);
}

function discordUser(interaction) {
  return interaction?.member?.user || interaction?.user || null;
}

async function handleRawInteraction(request, env, ctx) {
  const rawBody = await request.arrayBuffer();
  if (!await verifyDiscordRawRequest(request, rawBody, env.DISCORD_PUBLIC_KEY)) {
    return new Response('invalid request signature', { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(decoder.decode(rawBody));
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2) {
    return json({ type: 4, data: { flags: EPHEMERAL, content: 'Unsupported Discord interaction.' } });
  }

  const command = String(interaction?.data?.name || '').toLowerCase();
  if (command !== 'ask') {
    return json({ type: 4, data: { flags: EPHEMERAL, content: 'Use `/ask` to talk to Collectish.' } });
  }

  const user = discordUser(interaction);
  const question = commandQuestion(interaction);
  const scope = discordScope(interaction);
  if (!user?.id || !scope.channel_id) {
    return json({ type: 4, data: { flags: EPHEMERAL, content: 'Discord did not provide enough context for this request.' } });
  }
  if (!question) {
    return json({ type: 4, data: { flags: EPHEMERAL, content: 'Add a question to `/ask`.' } });
  }
  if (!env.DISCORD_ASK_QUEUE?.send) {
    return json({ type: 4, data: { flags: EPHEMERAL, content: 'Ask Collectish Discord queue is not configured.' } });
  }

  const job = {
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
  };

  const enqueue = env.DISCORD_ASK_QUEUE.send(job).catch((error) => {
    console.error('discord ask enqueue failed after defer', {
      interaction_id: job.interaction_id,
      error: String(error?.message || error),
    });
  });
  if (ctx?.waitUntil) ctx.waitUntil(enqueue);

  // Discord only gives interaction handlers a few seconds to acknowledge. Do not
  // wait on Queue latency before returning the defer; the Queue send continues via waitUntil.
  // Visibility is locked at defer time, so successful /ask responses are channel messages.
  return json({ type: 5, data: {} });
}

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

async function linkForDiscord(env, discordUserId) {
  const rows = await serviceRest(
    env,
    `discord_collectish_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=id,user_id,discord_user_id&limit=1`,
  );
  return rows?.[0] || null;
}

async function claimGuestDelivery(env, job) {
  const rows = await serviceRest(env, 'rpc/claim_discord_ask_delivery', {
    method: 'POST',
    body: { p_interaction_id: job.interaction_id, p_discord_user_id: job.discord_user_id },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateDelivery(env, interactionId, patch) {
  await serviceRest(env, `discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(interactionId)}`, {
    method: 'PATCH',
    body: { ...patch, updated_at: nowIso() },
  });
}

async function editOriginalDiscord(job, payload) {
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!response.ok) throw new Error(`Discord webhook edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
}

function guestNeedsAccount(question) {
  const q = String(question || '');
  return [
    /\bmy\s+(?:account|inventory|collection|seller|sales?|orders?|purchases?|watchlist|settings|history|tcgplayer|direct|syp|buylist|pricing|prices?|profit|revenue|spend|spending)\b/i,
    /\b(?:seller history|account history|my direct|my tcgplayer|my syp|my orders?|my sales?|my purchases?)\b/i,
    /\b(?:what|how much)\s+(?:did|have)\s+i\s+(?:sell|sold|buy|bought|spend|spent|make|made)\b/i,
    /\b(?:show|check|look at|analyze|review)\s+my\b/i,
    /\b(?:saved|private|personal)\s+(?:data|cards?|list|settings|history)\b/i,
  ].some((pattern) => pattern.test(q));
}

async function hmac(env, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.DISCORD_LINK_TICKET_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

async function makeLinkTicket(env, job) {
  const payload = base64url(encoder.encode(JSON.stringify({
    discord_user_id: job.discord_user_id,
    discord_username: clean(job.discord_username, 80),
    discord_global_name: clean(job.discord_global_name, 120),
    exp: Date.now() + 15 * 60 * 1000,
  })));
  return `${payload}.${await hmac(env, payload)}`;
}

async function linkPayload(env, job, reason = 'That request uses private Collectish account data.') {
  const ticket = await makeLinkTicket(env, job);
  const url = `${String(env.DISCORD_WORKER_BASE_URL).replace(/\/$/, '')}/discord/link/start?ticket=${encodeURIComponent(ticket)}`;
  return {
    content: `${reason} Link your Collectish account once to continue.`,
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Link Collectish', url }] }],
  };
}

async function callGuestAsk(env, job) {
  const response = await fetch(`${supabaseBase(env)}/functions/v1/ask-collectish-api`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'chat',
      client: 'discord_guest',
      guest: true,
      message: job.question,
      context: {
        screen: 'discord',
        access_mode: 'guest',
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
  if (!response.ok) {
    const error = new Error(data?.error || `Guest Ask API HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function answerText(data) {
  const value = data?.response ?? data?.answer ?? data?.message ?? 'Ask Collectish completed without a text response.';
  const text = String(value || '').trim();
  return text.length <= MAX_DISCORD_CONTENT ? text : `${text.slice(0, MAX_DISCORD_CONTENT - 18)}\n\n…continued in Collectish`;
}

async function processGuestJob(env, job) {
  const claim = await claimGuestDelivery(env, job);
  if (!claim?.claimed) return;

  if (claim.saved_response_text) {
    await editOriginalDiscord(job, { content: claim.saved_response_text, components: [] });
    await updateDelivery(env, job.interaction_id, { status: 'completed', completed_at: nowIso() });
    return;
  }

  if (guestNeedsAccount(job.question)) {
    const payload = await linkPayload(env, job);
    await editOriginalDiscord(job, payload);
    await updateDelivery(env, job.interaction_id, { status: 'link_required', completed_at: nowIso() });
    return;
  }

  try {
    const data = await callGuestAsk(env, job);
    const content = answerText(data);
    await updateDelivery(env, job.interaction_id, { response_text: content });
    await editOriginalDiscord(job, { content, components: [] });
    await updateDelivery(env, job.interaction_id, {
      status: 'completed',
      completed_at: nowIso(),
      error_text: null,
    });
  } catch (error) {
    const message = clean(error?.message || error, 500);
    const payload = await linkPayload(
      env,
      job,
      /auth|permission|rls|401|403/i.test(message)
        ? 'Guest mode cannot access the data needed for that request.'
        : 'Guest mode could not complete that request.',
    );
    await editOriginalDiscord(job, payload);
    await updateDelivery(env, job.interaction_id, {
      status: 'link_required',
      completed_at: nowIso(),
      error_text: message,
    });
  }
}

async function handleQueue(batch, env, ctx) {
  for (const message of batch.messages) {
    const job = message.body || {};
    try {
      const link = job.discord_user_id ? await linkForDiscord(env, job.discord_user_id) : null;
      if (link) {
        await worker.queue({ messages: [message] }, env, ctx);
        continue;
      }
      await processGuestJob(env, job);
      message.ack();
    } catch (error) {
      console.error('discord guest ask job failed', {
        interaction_id: job.interaction_id,
        error: String(error?.message || error),
      });
      message.retry({ delaySeconds: Math.min(60, 5 * Math.max(1, Number(message.attempts || 1))) });
    }
  }
}

async function discordDiagnostic(env) {
  const raw = env.DISCORD_PUBLIC_KEY;
  const value = String(raw ?? '').trim();
  const shapeOk = /^[0-9a-f]{64}$/i.test(value);
  let ed25519ImportOk = false;
  let importError = null;

  if (shapeOk) {
    try {
      const bytes = hexToBytes(value, 32);
      await crypto.subtle.importKey('raw', bytes, { name: 'Ed25519' }, false, ['verify']);
      ed25519ImportOk = true;
    } catch (error) {
      importError = String(error?.name || error?.message || error).slice(0, 120);
    }
  }

  return json({
    service: 'collectish-discord',
    discord_public_key_present: raw !== undefined && raw !== null && String(raw).length > 0,
    discord_public_key_trimmed_length: value.length,
    discord_public_key_shape_ok: shapeOk,
    ed25519_import_ok: ed25519ImportOk,
    ed25519_import_error: importError,
    discord_application_id_present: Boolean(String(env.DISCORD_APPLICATION_ID ?? '').trim()),
    queue_present: Boolean(env.DISCORD_ASK_QUEUE?.send),
    kv_present: Boolean(env.DISCORD_LINK_STATE?.get),
    signature_verification_mode: 'raw-bytes',
    guest_mode: 'anon-rls',
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/discord/diagnostics') return discordDiagnostic(env);
    if (request.method === 'POST' && url.pathname === '/discord/interactions') return handleRawInteraction(request, env, ctx);
    return worker.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return handleQueue(batch, env, ctx);
  },
};
