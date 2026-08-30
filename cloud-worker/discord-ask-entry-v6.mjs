import entry from './discord-ask-entry-v5.mjs';
import { commandQuestion, discordScope } from './discord-ask-worker.mjs';

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
  const ts = encoder.encode(timestamp);
  const body = new Uint8Array(rawBody);
  const signed = new Uint8Array(ts.length + body.length);
  signed.set(ts, 0);
  signed.set(body, ts.length);
  const key = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, signature, signed);
}

function discordUser(interaction) {
  return interaction?.member?.user || interaction?.user || null;
}

// Privacy is decided before the initial Discord defer. Ephemeral visibility cannot
// be converted into a persistent channel message by a later webhook edit.
function requiresPrivateResponse(question) {
  const q = String(question || '');
  return [
    /\bmy\s+(?:account|inventory|collection|seller|sales?|orders?|purchases?|watchlist|settings|history|tcgplayer|direct|syp|buylist|pricing|prices?|profit|revenue|spend|spending|returns?|refunds?)\b/i,
    /\b(?:seller history|account history|my direct|my tcgplayer|my syp|my orders?|my sales?|my purchases?|my inventory)\b/i,
    /\b(?:what|how much)\s+(?:did|have)\s+i\s+(?:sell|sold|buy|bought|spend|spent|make|made)\b/i,
    /\b(?:show|check|look at|analyze|review)\s+my\b/i,
    /\b(?:saved|private|personal)\s+(?:data|cards?|list|settings|history)\b/i,
    /\b(?:link|unlink|connect|disconnect)\s+(?:my\s+)?collectish\b/i,
  ].some((pattern) => pattern.test(q));
}

async function handleInteraction(request, env, ctx) {
  const rawBody = await request.arrayBuffer();
  if (!await verifyDiscordRawRequest(request, rawBody, env.DISCORD_PUBLIC_KEY)) {
    return new Response('invalid request signature', { status: 401 });
  }

  let interaction;
  try { interaction = JSON.parse(decoder.decode(rawBody)); }
  catch { return new Response('invalid json', { status: 400 }); }

  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2) {
    return json({ type: 4, data: { flags: EPHEMERAL, content: 'Unsupported Discord interaction.' } });
  }
  if (String(interaction?.data?.name || '').toLowerCase() !== 'ask') {
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

  const privateResponse = requiresPrivateResponse(question);
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
    response_visibility: privateResponse ? 'ephemeral' : 'public',
  };

  // Always acknowledge immediately; all expensive work stays on the queue.
  ctx.waitUntil(env.DISCORD_ASK_QUEUE.send(job).catch((error) => {
    console.error('discord enqueue failed', {
      interaction_id: job.interaction_id,
      error: String(error?.message || error),
    });
  }));

  // Omit flags entirely for a normal persistent channel response.
  return privateResponse
    ? json({ type: 5, data: { flags: EPHEMERAL } })
    : json({ type: 5, data: {} });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/discord/interactions') {
      return handleInteraction(request, env, ctx);
    }
    return entry.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return entry.queue(batch, env, ctx);
  },
};
