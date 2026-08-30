import worker, { commandQuestion, discordScope } from './discord-ask-worker.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EPHEMERAL = 1 << 6;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 2000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function hexToBytes(value, expectedBytes) {
  const hex = String(value || '').trim();
  if (!new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(hex)) return null;
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
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

async function handleRawInteraction(request, env) {
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

  return json({ type: 5, data: { flags: EPHEMERAL } });
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
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/discord/diagnostics') return discordDiagnostic(env);
    if (request.method === 'POST' && url.pathname === '/discord/interactions') return handleRawInteraction(request, env);
    return worker.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return worker.queue(batch, env, ctx);
  },
};
