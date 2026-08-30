import entry from './discord-ask-entry-v14.mjs';

const DISCORD_API = 'https://discord.com/api/v10';

function supabaseBase(env) {
  return String(env.SUPABASE_URL || '').replace(/\/$/, '');
}

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function serviceRest(env, path, init = {}) {
  const response = await fetch(`${supabaseBase(env)}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: { ...serviceHeaders(env), ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `Supabase REST ${response.status}`);
  return data;
}

async function editOriginalDiscord(job, payload) {
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!response.ok) throw new Error(`Discord webhook edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
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
    method: 'PATCH',
    body: { ...patch, updated_at: new Date().toISOString() },
  });
}

function extractMoveAlias(question) {
  const q = String(question || '').trim();
  const patterns = [
    /^why\s+(?:did|has)\s+(.+?)\s+(?:spike|move|jump|rise|rally)(?:d|n|en)?\??$/i,
    /^why\s+is\s+(.+?)\s+(?:spiking|moving|rising|jumping|up)\??$/i,
    /^what\s+(?:drove|is driving|was driving)\s+(.+?)(?:'s)?\s+(?:spike|move|price|rise)?\??$/i,
  ];
  for (const pattern of patterns) {
    const m = q.match(pattern);
    if (m?.[1]) return m[1].trim().replace(/[?.!,]+$/g, '');
  }
  return null;
}

async function lookupAlias(env, alias) {
  const rows = await serviceRest(env, 'rpc/ask_collectish_public_card_lookup_v1', {
    method: 'POST',
    body: { p_query: alias, p_limit: 24 },
  }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function recentSignals(env, alias) {
  const cutoff = new Date(Date.now() - 21 * 86400000).toISOString();
  const term = encodeURIComponent(`*${alias}*`);
  return serviceRest(
    env,
    `market_intel_items?observed_at=gte.${encodeURIComponent(cutoff)}&or=(title.ilike.${term},summary.ilike.${term})&select=intel_id,source_name,source_type,source_url,title,summary,published_at,observed_at&order=observed_at.desc&limit=20`,
  ).catch(() => []);
}

async function currentPrices(env, rows) {
  const skus = [...new Set(rows.map((r) => String(r.sku_id || '')).filter(Boolean))];
  if (!skus.length) return [];
  return serviceRest(
    env,
    `tcgplayer_official_sku_price_current?sku_id=in.(${skus.join(',')})&select=sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at`,
  ).catch(() => []);
}

async function getBinding(env, job) {
  const rows = await serviceRest(env, 'rpc/get_discord_ask_binding', {
    method: 'POST',
    body: {
      p_discord_user_id: String(job.discord_user_id || ''),
      p_channel_id: String(job.channel_id || ''),
      p_thread_id: job.thread_id ? String(job.thread_id) : null,
    },
  }).catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

async function externalResearch(env, job, alias, rows) {
  const primary = rows.find((r) => r.source === 'scout_card_catalog' && r.scryfall_id) || rows[0];
  if (!primary?.product_id && !primary?.sku_id) return null;
  const binding = await getBinding(env, job);
  const products = [...new Set(rows.map((r) => `${r.card_name} [${r.set_code} #${r.collector_number || '?'} ${r.printing || ''}]`))].join('; ');
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
      ...(binding?.ask_session_id ? { session_id: binding.ask_session_id } : {}),
      message: `Research externally why ${alias} Magic: The Gathering cards spiked. This alias maps to these known MTG products/printings: ${products}. Look for a common real-world or MTG catalyst and compare timing against the market move. Do not ask me to choose a printing unless the evidence truly differs by printing.`,
      context: {
        screen: 'discord',
        product_id: String(primary.product_id || ''),
        sku_id: String(primary.sku_id || ''),
        entity: {
          product_id: String(primary.product_id || ''),
          sku_id: String(primary.sku_id || ''),
          scryfall_id: primary.scryfall_id || null,
          card_name: primary.card_name || alias,
        },
        discord: {
          interaction_id: job.interaction_id,
          discord_user_id: job.discord_user_id,
          guild_id: job.guild_id || null,
          channel_id: job.channel_id || null,
          thread_id: job.thread_id || null,
        },
      },
    }),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) return null;
  return data;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function truncate(value, max = 1000) {
  const s = String(value || '').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function payload(alias, rows, prices, signals, research) {
  const priceBySku = new Map((prices || []).map((p) => [String(p.sku_id), p]));
  const seen = new Set();
  const printingLines = [];
  for (const row of rows) {
    const key = `${row.product_id}|${row.sku_id}|${row.printing}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = priceBySku.get(String(row.sku_id));
    printingLines.push(`• **${row.card_name}** — ${row.set_code} #${row.collector_number || '?'} · ${row.printing || 'printing'}${p ? ` · Market ${money(p.market_price)} · Low ${money(p.lowest_listing_price ?? p.low_price)}` : ''}`);
  }

  const signalLines = (signals || []).slice(0, 7).map((s) => {
    const title = s.source_url ? `[${s.title || s.source_name}](${s.source_url})` : (s.title || s.source_name || 'Signal');
    return `• ${title}${s.summary ? `\n  ${s.summary}` : ''}`;
  });

  const researchText = String(research?.response || research?.answer || '').trim();
  const fields = [
    { name: 'Matched MTG products / printings', value: truncate(printingLines.join('\n'), 1000), inline: false },
    { name: 'Market signals', value: signalLines.length ? truncate(signalLines.join('\n'), 1000) : 'No recent named Signals matched this alias.', inline: false },
  ];
  if (researchText) fields.push({ name: 'External research', value: truncate(researchText, 1000), inline: false });

  return {
    content: '',
    embeds: [{
      title: `${alias} — multi-printing market move`,
      description: `I found ${seen.size} matching MTG SKU/printing entr${seen.size === 1 ? 'y' : 'ies'} and investigated them as one card-family move instead of asking you to choose a printing.`,
      fields,
      footer: { text: 'Collectish public MTG identity + Signals + external research when available' },
    }],
    components: [],
  };
}

async function handleAliasMove(env, job, message) {
  const alias = extractMoveAlias(job.question);
  if (!alias) return false;
  const rows = await lookupAlias(env, alias);
  if (!rows.length) return false;

  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return true;
  }

  try {
    await editOriginalDiscord(job, { content: `🔎 Delvin is tracing the ${alias} move across MTG printings…`, embeds: [], components: [] }).catch(() => null);
    const [prices, signals, research] = await Promise.all([
      currentPrices(env, rows),
      recentSignals(env, alias),
      externalResearch(env, job, alias, rows),
    ]);
    await editOriginalDiscord(job, payload(alias, rows, prices, signals, research));
    const responseText = String(research?.response || research?.answer || `${alias}: multi-printing move with ${signals?.length || 0} recent Signals`).slice(0, 1900);
    await updateDelivery(env, job.interaction_id, {
      response_text: responseText,
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_text: null,
    });
    message.ack();
    return true;
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 500);
    await editOriginalDiscord(job, { content: `Delvin couldn't finish the multi-printing market investigation: ${detail}`, embeds: [], components: [] }).catch(() => null);
    await updateDelivery(env, job.interaction_id, { status: 'failed', error_text: detail, completed_at: new Date().toISOString() }).catch(() => null);
    message.ack();
    return true;
  }
}

async function handleQueue(batch, env, ctx) {
  const fallback = [];
  for (const message of batch.messages) {
    const job = message.body || {};
    const isPrivate = String(job.response_visibility || '').toLowerCase() === 'ephemeral';
    if (isPrivate || !extractMoveAlias(job.question)) {
      fallback.push(message);
      continue;
    }
    const handled = await handleAliasMove(env, job, message);
    if (!handled) fallback.push(message);
  }
  if (fallback.length) return entry.queue({ messages: fallback }, env, ctx);
}

export default {
  fetch(request, env, ctx) { return entry.fetch(request, env, ctx); },
  queue(batch, env, ctx) { return handleQueue(batch, env, ctx); },
};
