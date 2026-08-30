import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const A = Deno.env.get('SUPABASE_ANON_KEY') || '';
const S = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const C = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const API_SCHEMA = 'collectish.ask.api.v1';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...C, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const token = (req: Request) => {
  const value = req.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7) : '';
};

const headers = (accessToken: string) => ({
  apikey: A,
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

const serviceHeaders = () => ({
  apikey: S,
  Authorization: `Bearer ${S}`,
  'Content-Type': 'application/json',
});

async function rest(accessToken: string, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const response = await fetch(`${U}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      ...headers(accessToken),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `REST failed (${response.status})`);
  return data;
}

async function serviceRest(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  if (!S) throw new Error('Guest auth service role is unavailable');
  const response = await fetch(`${U}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      ...serviceHeaders(),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `Service REST failed (${response.status})`);
  return data;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(String(value || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function guestEncryptionKey() {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`collectish-discord-guest-v1:${S}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptGuestRefreshToken(value: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await guestEncryptionKey(), encoder.encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(cipher)), iv: bytesToBase64(iv) };
}

async function decryptGuestRefreshToken(ciphertext: string, iv: string) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    await guestEncryptionKey(),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(plain);
}

async function authRequest(path: string, body: unknown) {
  const response = await fetch(`${U}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: A,
      Authorization: `Bearer ${A}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || `Auth HTTP ${response.status}`;
    const error: any = new Error(message);
    error.status = response.status;
    error.code = data?.code || data?.error_code || null;
    throw error;
  }
  return data;
}

async function guestDiscordUserId(body: any) {
  const explicit = String(body?.context?.discord?.discord_user_id || '').trim();
  if (explicit) return explicit;
  const interactionId = String(body?.context?.discord?.interaction_id || '').trim();
  if (!interactionId) throw new Error('Discord guest identity is missing');
  const rows = await serviceRest(
    `discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(interactionId)}&select=discord_user_id&limit=1`,
  );
  const id = String(rows?.[0]?.discord_user_id || '').trim();
  if (!id) throw new Error('Discord guest identity could not be resolved');
  return id;
}

async function persistGuestSession(discordUserId: string, anonymousUserId: string | null, refreshToken: string) {
  const encrypted = await encryptGuestRefreshToken(refreshToken);
  await serviceRest('discord_guest_auth_sessions?on_conflict=discord_user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: [{
      discord_user_id: discordUserId,
      anonymous_user_id: anonymousUserId || null,
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
      updated_at: new Date().toISOString(),
    }],
  });
}

async function refreshGuestSession(row: any) {
  const refreshToken = await decryptGuestRefreshToken(row.refresh_token_ciphertext, row.refresh_token_iv);
  const data = await authRequest('token?grant_type=refresh_token', { refresh_token: refreshToken });
  if (!data?.access_token) throw new Error('Guest refresh did not return an access token');
  if (data.refresh_token) {
    await persistGuestSession(String(row.discord_user_id), data?.user?.id || row.anonymous_user_id || null, data.refresh_token);
  }
  return data.access_token as string;
}

async function createGuestSession(discordUserId: string) {
  const data = await authRequest('signup', {
    data: { source: 'discord_guest' },
  });
  if (!data?.access_token || !data?.refresh_token) {
    throw new Error('Anonymous sign-in did not return a session. Enable anonymous sign-ins in Supabase Authentication settings.');
  }
  await persistGuestSession(discordUserId, data?.user?.id || null, data.refresh_token);
  return data.access_token as string;
}

async function guestAccessToken(body: any) {
  const discordUserId = await guestDiscordUserId(body);
  const rows = await serviceRest(
    `discord_guest_auth_sessions?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=discord_user_id,anonymous_user_id,refresh_token_ciphertext,refresh_token_iv&limit=1`,
  );
  const row = rows?.[0] || null;
  if (row) {
    try {
      return await refreshGuestSession(row);
    } catch {
      await serviceRest(`discord_guest_auth_sessions?discord_user_id=eq.${encodeURIComponent(discordUserId)}`, { method: 'DELETE' }).catch(() => null);
    }
  }
  return createGuestSession(discordUserId);
}

async function orchestrate(accessToken: string, body: any) {
  const response = await fetch(`${U}/functions/v1/ask-collectish-orchestrator`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw || `HTTP ${response.status}` }; }
  if (!response.ok) return { ok: false, status: response.status, data };
  return { ok: true, status: response.status, data };
}

const text = (value: unknown) => String(value ?? '').trim();
const publicSession = (row: any) => row ? ({
  id: row.id,
  title: row.title ?? null,
  updated_at: row.updated_at ?? null,
  created_at: row.created_at ?? null,
}) : null;

async function createSession(accessToken: string, body: any) {
  const title = text(body?.title || body?.message || 'New conversation').slice(0, 90) || 'New conversation';
  const rows = await rest(accessToken, 'ask_collectish_conversations', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{ title }],
  });
  const session = publicSession(rows?.[0]);
  if (!session?.id) throw new Error('Ask session was not created');
  return { api_schema: API_SCHEMA, session };
}

async function listSessions(accessToken: string, body: any) {
  const requested = Number(body?.limit || 30);
  const limit = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 30, 100));
  const sessions = await rest(
    accessToken,
    `ask_collectish_conversations?select=id,title,updated_at,created_at&order=updated_at.desc&limit=${limit}`,
  );
  return { api_schema: API_SCHEMA, sessions: Array.isArray(sessions) ? sessions.map(publicSession) : [] };
}

async function getSession(accessToken: string, body: any) {
  const id = text(body?.session_id || body?.conversation_id);
  if (!id) return { error: 'session_id required', status: 400 };
  const encoded = encodeURIComponent(id);
  const sessions = await rest(
    accessToken,
    `ask_collectish_conversations?id=eq.${encoded}&select=id,title,updated_at,created_at&limit=1`,
  );
  const session = publicSession(sessions?.[0]);
  if (!session) return { error: 'Ask session not found', status: 404 };
  const messages = await rest(
    accessToken,
    `ask_collectish_messages?select=id,role,content,metadata,created_at&conversation_id=eq.${encoded}&order=created_at.asc&limit=250`,
  );
  return {
    api_schema: API_SCHEMA,
    session,
    messages: Array.isArray(messages) ? messages : [],
  };
}

async function touchSession(accessToken: string, id: unknown) {
  const sessionId = text(id);
  if (!sessionId) return;
  await rest(accessToken, `ask_collectish_conversations?id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: { updated_at: new Date().toISOString() },
  }).catch(() => null);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: C });
  if (req.method !== 'POST') return json({ api_schema: API_SCHEMA, error: 'POST required' }, 405);

  const requestToken = token(req);
  if (!requestToken) return json({ api_schema: API_SCHEMA, error: 'Authentication required' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ api_schema: API_SCHEMA, error: 'Invalid JSON' }, 400); }

  const isDiscordGuest = body?.guest === true && text(body?.client).toLowerCase() === 'discord_guest';

  const action = text(body?.action || 'chat').toLowerCase();
  try {
    const accessToken = isDiscordGuest ? await guestAccessToken(body) : requestToken;

    if (action === 'session.create') return json(await createSession(accessToken, body));
    if (action === 'session.list') return json(await listSessions(accessToken, body));
    if (action === 'session.get') {
      const result: any = await getSession(accessToken, body);
      if (result?.error) return json({ api_schema: API_SCHEMA, error: result.error }, result.status || 400);
      return json(result);
    }

    const orchestratorBody = {
      ...body,
      ...(body?.conversation_id ? {} : body?.session_id ? { conversation_id: body.session_id } : {}),
    };
    const result = await orchestrate(accessToken, orchestratorBody);
    if (!result.ok) return json({ api_schema: API_SCHEMA, ...result.data }, result.status);

    const data = result.data || {};
    const sessionId = data.conversation_id || orchestratorBody.conversation_id || null;
    if (action === 'chat') await touchSession(accessToken, sessionId);
    return json({
      api_schema: API_SCHEMA,
      client: text(body?.client || 'web') || 'web',
      guest: isDiscordGuest,
      session_id: sessionId,
      ...data,
    });
  } catch (error) {
    const message = String((error as Error)?.message || error || 'Ask API request failed');
    return json({
      api_schema: API_SCHEMA,
      error: message,
      ...(isDiscordGuest ? { guest_setup_required: /anonymous sign|anonymous provider|provider.*disabled/i.test(message) } : {}),
    }, 500);
  }
});
