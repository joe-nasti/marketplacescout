import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const A = Deno.env.get('SUPABASE_ANON_KEY') || '';
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

async function createSession(accessToken: string, body: any) {
  const title = text(body?.title || body?.message || 'New conversation').slice(0, 90) || 'New conversation';
  const rows = await rest(accessToken, 'ask_collectish_conversations', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{ title }],
  });
  const session = rows?.[0] || null;
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
  return { api_schema: API_SCHEMA, sessions: Array.isArray(sessions) ? sessions : [] };
}

async function getSession(accessToken: string, body: any) {
  const id = text(body?.session_id || body?.conversation_id);
  if (!id) return { error: 'session_id required', status: 400 };
  const encoded = encodeURIComponent(id);
  const sessions = await rest(
    accessToken,
    `ask_collectish_conversations?id=eq.${encoded}&select=id,title,updated_at,created_at&limit=1`,
  );
  const session = sessions?.[0] || null;
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

  const accessToken = token(req);
  if (!accessToken) return json({ api_schema: API_SCHEMA, error: 'Authentication required' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ api_schema: API_SCHEMA, error: 'Invalid JSON' }, 400); }

  const action = text(body?.action || 'chat').toLowerCase();
  try {
    if (action === 'session.create') return json(await createSession(accessToken, body));
    if (action === 'session.list') return json(await listSessions(accessToken, body));
    if (action === 'session.get') {
      const result: any = await getSession(accessToken, body);
      if (result?.error) return json({ api_schema: API_SCHEMA, error: result.error }, result.status || 400);
      return json(result);
    }

    // Chat, health, and existing orchestrator actions intentionally retain their current
    // request/response contract. The facade only adds a stable schema marker and client id.
    const result = await orchestrate(accessToken, body);
    if (!result.ok) return json({ api_schema: API_SCHEMA, ...result.data }, result.status);

    const data = result.data || {};
    if (action === 'chat') await touchSession(accessToken, data.conversation_id || body?.conversation_id);
    return json({
      api_schema: API_SCHEMA,
      client: text(body?.client || 'web') || 'web',
      ...data,
    });
  } catch (error) {
    return json({
      api_schema: API_SCHEMA,
      error: String((error as Error)?.message || error || 'Ask API request failed'),
    }, 500);
  }
});
