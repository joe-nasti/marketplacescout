import worker from './discord-ask-worker.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function discordDiagnostic(env) {
  const raw = env.DISCORD_PUBLIC_KEY;
  const value = String(raw ?? '').trim();
  const shapeOk = /^[0-9a-f]{64}$/i.test(value);
  let ed25519ImportOk = false;
  let importError = null;

  if (shapeOk) {
    try {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
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
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/discord/diagnostics') return discordDiagnostic(env);
    return worker.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return worker.queue(batch, env, ctx);
  },
};
