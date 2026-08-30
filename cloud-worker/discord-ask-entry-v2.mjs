import entry from './discord-ask-entry.mjs';
import { commandQuestion, discordScope } from './discord-ask-worker.mjs';

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

function supabaseBase(env) {
  return String(env.SUPABASE_URL || '').replace(/\/$/, '');
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

async function handleInteraction(request, env, ctx) {
  const rawBody = await request.arrayBuffer();
  if (!await verifyDiscordRawRequest(request, rawBody, env.DISCORD_PUBLIC_KEY)) {
    return new Response('invalid request signature', { status: 401 });
  }
  let interaction;
  try { interaction = JSON.parse(decoder.decode(rawBody)); }
  catch { return new Response('invalid json', { status: 400 }); }

  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Unsupported Discord interaction.' } });
  if (String(interaction?.data?.name || '').toLowerCase() !== 'ask') {
    return json({ type: 4, data: { flags: EPHEMERAL, content: 'Use `/ask` to talk to Collectish.' } });
  }

  const user = discordUser(interaction);
  const question = commandQuestion(interaction);
  const scope = discordScope(interaction);
  if (!user?.id || !scope.channel_id) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Discord did not provide enough context for this request.' } });
  if (!question) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Add a question to `/ask`.' } });
  if (!env.DISCORD_ASK_QUEUE?.send) return json({ type: 4, data: { flags: EPHEMERAL, content: 'Ask Collectish Discord queue is not configured.' } });

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

  // Discord requires an initial response within ~3 seconds. Do not make queue
  // delivery part of that critical path; Cloudflare keeps this promise alive.
  ctx.waitUntil(env.DISCORD_ASK_QUEUE.send(job).catch((error) => {
    console.error('discord enqueue failed', { interaction_id: job.interaction_id, error: String(error?.message || error) });
  }));
  return json({ type: 5, data: { flags: EPHEMERAL } });
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
  const rows = await serviceRest(env, `discord_collectish_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=id&limit=1`);
  return rows?.[0] || null;
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
    method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() },
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

function extractCardName(question) {
  const q = clean(question, 500);
  const patterns = [
    /^where\s+is\s+(.+?)\s+seeing\s+play\??$/i,
    /^where\s+does\s+(.+?)\s+see\s+play\??$/i,
    /^what\s+(?:decks?|archetypes?)\s+(?:play|use|run)\s+(.+?)\??$/i,
    /^why\s+is\s+(.+?)\s+(?:moving|spiking|rising|up)\??$/i,
    /^why\s+did\s+(.+?)\s+(?:move|spike|jump|rise)\??$/i,
    /^what\s+is\s+driving\s+(.+?)(?:'s)?\s+(?:price|move|spike)\??$/i,
  ];
  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match?.[1]) return clean(match[1].replace(/[?.!,]+$/g, ''), 160);
  }
  return null;
}

function isPlayIntent(question) {
  return /\bseeing\s+play\b|\bsee\s+play\b|\bwhat\s+(?:decks?|archetypes?)\s+(?:play|use|run)\b/i.test(question || '');
}

function isMoveIntent(question) {
  return /\b(?:moving|spiking|rising|price spike|price move)\b|\bwhy\s+did\b.*\b(?:move|spike|jump|rise)\b/i.test(question || '');
}

async function resolveCard(env, question) {
  const name = extractCardName(question);
  if (!name) return null;
  const rows = await serviceRest(env,
    `scout_card_catalog?card_name=ilike.${encodeURIComponent(name)}&select=sku_id,product_id,scryfall_id,card_name,set_code,collector_number,printing,condition,language&limit=30`,
  ).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  const exact = rows.filter((r) => String(r.card_name || '').toLowerCase() === name.toLowerCase());
  const pool = exact.length ? exact : rows;
  pool.sort((a, b) => {
    const score = (r) =>
      (String(r.condition || '').toUpperCase() === 'NEAR MINT' ? 8 : 0) +
      (String(r.language || '').toUpperCase() === 'ENGLISH' ? 4 : 0) +
      (/NON\s*FOIL/i.test(String(r.printing || '')) ? 2 : 0);
    return score(b) - score(a);
  });
  return { name: pool[0].card_name, primary: pool[0], printings: pool.slice(0, 12) };
}

async function competitivePlayAnswer(env, resolved) {
  const cardName = resolved?.name;
  if (!cardName) return null;
  const rollups = await serviceRest(env,
    `competitive_card_rollups?card_name=ilike.${encodeURIComponent(cardName)}&select=card_name,format,event_count_30d,deck_count_30d,top8_decks_30d,wins_30d,copies_30d,decks_7d,decks_prev_7d,last_seen&order=deck_count_30d.desc.nullslast`,
  ).catch(() => []);
  if (!Array.isArray(rollups) || !rollups.length) return `I resolved **${cardName}** as an MTG card, but Collectish has no recent competitive deck appearances for it yet.`;

  const cards = await serviceRest(env,
    `competitive_deck_cards?card_name=ilike.${encodeURIComponent(cardName)}&select=deck_id,section,quantity&order=created_at.desc&limit=60`,
  ).catch(() => []);
  const deckIds = [...new Set((cards || []).map((r) => r.deck_id).filter(Boolean))].slice(0, 40);
  let decks = [];
  let events = [];
  if (deckIds.length) {
    decks = await serviceRest(env,
      `competitive_decks?deck_id=in.(${deckIds.join(',')})&select=deck_id,event_id,player_name,placement,archetype,record,source_url&limit=40`,
    ).catch(() => []);
    const eventIds = [...new Set((decks || []).map((r) => r.event_id).filter(Boolean))].slice(0, 30);
    if (eventIds.length) {
      events = await serviceRest(env,
        `competitive_events?event_id=in.(${eventIds.join(',')})&select=event_id,event_name,format,event_type,event_date,source_url&order=event_date.desc&limit=30`,
      ).catch(() => []);
    }
  }
  const eventById = new Map((events || []).map((e) => [e.event_id, e]));
  const recent = (decks || []).map((d) => ({ ...d, event: eventById.get(d.event_id) })).filter((d) => d.event).sort((a, b) => String(b.event.event_date).localeCompare(String(a.event.event_date)) || Number(a.placement || 999) - Number(b.placement || 999));

  const formatBits = rollups.slice(0, 5).map((r) => {
    const trend = Number(r.decks_prev_7d || 0) > 0
      ? `, ${Number(r.decks_7d || 0)} decks in the last 7d vs ${Number(r.decks_prev_7d || 0)} prior`
      : '';
    return `**${r.format}**: ${Number(r.deck_count_30d || 0)} decks / ${Number(r.event_count_30d || 0)} events in 30d, ${Number(r.top8_decks_30d || 0)} Top 8s, ${Number(r.wins_30d || 0)} wins${trend}`;
  });
  const recentBits = recent.slice(0, 5).map((d) => {
    const archetype = d.archetype ? `, ${d.archetype}` : '';
    const place = d.placement ? `#${d.placement}` : 'listed';
    return `${d.event.event_date} ${d.event.format} ${d.event.event_name}: ${place} ${d.player_name || 'player'}${archetype}`;
  });
  return [
    `**${cardName} is seeing real competitive play.**`,
    ...formatBits,
    recentBits.length ? `Recent examples: ${recentBits.join(' · ')}` : null,
    `This is based on Collectish's imported competitive decklists; archetype labels may be missing on some MTGO lists even when the deck itself is captured.`,
  ].filter(Boolean).join('\n');
}

async function hmac(env, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.DISCORD_LINK_TICKET_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlText(value) {
  const bytes = encoder.encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function linkPayload(env, job) {
  const body = base64urlText(JSON.stringify({
    discord_user_id: job.discord_user_id,
    discord_username: clean(job.discord_username, 80),
    discord_global_name: clean(job.discord_global_name, 120),
    exp: Date.now() + 15 * 60 * 1000,
  }));
  const ticket = `${body}.${await hmac(env, body)}`;
  const url = `${String(env.DISCORD_WORKER_BASE_URL).replace(/\/$/, '')}/discord/link/start?ticket=${encodeURIComponent(ticket)}`;
  return {
    content: 'That request uses private Collectish account data. Link your Collectish account once to continue.',
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Link Collectish', url }] }],
  };
}

async function callGuestAsk(env, job, resolved) {
  const primary = resolved?.primary || null;
  const context = {
    screen: 'discord',
    access_mode: 'guest',
    ...(primary ? {
      product_id: primary.product_id || null,
      sku_id: primary.sku_id || null,
      scryfall_id: primary.scryfall_id || null,
      card_name: primary.card_name || resolved.name,
      set_code: primary.set_code || null,
      entity: {
        type: 'mtg_card',
        product_id: primary.product_id || null,
        sku_id: primary.sku_id || null,
        scryfall_id: primary.scryfall_id || null,
        card_name: primary.card_name || resolved.name,
        set_code: primary.set_code || null,
      },
      discord_card_resolution: {
        assumed_game: 'Magic: The Gathering',
        resolved_name: resolved.name,
        printing_count: resolved.printings.length,
        resolution: 'card-name-to-canonical-printing',
      },
    } : {}),
    discord: {
      guild_id: job.guild_id || null,
      channel_id: job.channel_id,
      thread_id: job.thread_id || null,
      interaction_id: job.interaction_id,
      discord_user_id: job.discord_user_id,
    },
  };
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
      context,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Guest Ask API HTTP ${response.status}`);
  return data;
}

function answerText(data) {
  const value = data?.response ?? data?.answer ?? data?.message ?? 'Ask Collectish completed without a text response.';
  const text = String(value || '').trim();
  return text.length <= MAX_DISCORD_CONTENT ? text : `${text.slice(0, MAX_DISCORD_CONTENT - 24)}\n\n…continued in Collectish`;
}

async function processGuest(env, job) {
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) return;
  if (claim.saved_response_text) {
    await editOriginalDiscord(job, { content: claim.saved_response_text, components: [] });
    await updateDelivery(env, job.interaction_id, { status: 'completed', completed_at: new Date().toISOString() });
    return;
  }
  if (guestNeedsAccount(job.question)) {
    const payload = await linkPayload(env, job);
    await editOriginalDiscord(job, payload);
    await updateDelivery(env, job.interaction_id, { status: 'link_required', completed_at: new Date().toISOString() });
    return;
  }

  await editOriginalDiscord(job, { content: '🔎 Delvin is digging through Collectish…', components: [] }).catch(() => null);
  const resolved = await resolveCard(env, job.question);
  let content;
  if (resolved && isPlayIntent(job.question)) {
    content = await competitivePlayAnswer(env, resolved);
  } else {
    const data = await callGuestAsk(env, job, resolved);
    content = answerText(data);
    if (resolved && isMoveIntent(job.question) && !/\b(?:market|price|sales|supply|signal|deck|edhrec)\b/i.test(content)) {
      content = `I resolved **${resolved.name}** as the MTG card automatically. ${content}`;
    }
  }
  content = String(content || 'No result returned.').slice(0, MAX_DISCORD_CONTENT);
  await updateDelivery(env, job.interaction_id, { response_text: content });
  await editOriginalDiscord(job, { content, components: [] });
  await updateDelivery(env, job.interaction_id, { status: 'completed', completed_at: new Date().toISOString(), error_text: null });
}

async function handleQueue(batch, env, ctx) {
  for (const message of batch.messages) {
    const job = message.body || {};
    try {
      const link = job.discord_user_id ? await linkForDiscord(env, job.discord_user_id) : null;
      if (link) {
        await editOriginalDiscord(job, { content: '🔎 Delvin is digging through Collectish…', components: [] }).catch(() => null);
        await entry.queue({ messages: [message] }, env, ctx);
        continue;
      }
      await processGuest(env, job);
      message.ack();
    } catch (error) {
      const msg = clean(error?.message || error, 500);
      console.error('discord ask v2 job failed', { interaction_id: job.interaction_id, error: msg });
      await updateDelivery(env, job.interaction_id, { status: 'failed', error_text: msg }).catch(() => null);
      await editOriginalDiscord(job, { content: 'Delvin hit an internal error while digging through Collectish. Try `/ask` again in a moment.', components: [] }).catch(() => null);
      message.ack();
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/discord/interactions') return handleInteraction(request, env, ctx);
    return entry.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return handleQueue(batch, env, ctx);
  },
};
