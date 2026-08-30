import entry from './discord-ask-entry-v15.mjs';

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

function moveAlias(question) {
  const q = String(question || '').trim();
  const patterns = [
    /^why\s+(?:did|has)\s+(.+?)\s+(?:spike|spiked|move|moved|jump|jumped|rise|rose|rally|rallied)\??$/i,
    /^why\s+is\s+(.+?)\s+(?:spiking|moving|rising|jumping|up)\??$/i,
    /^what\s+(?:drove|is\s+driving|was\s+driving)\s+(.+?)(?:'s)?(?:\s+(?:spike|move|price|rise))?\??$/i,
    /^what\s+happened\s+to\s+(.+?)\??$/i,
  ];
  for (const pattern of patterns) {
    const m = q.match(pattern);
    if (m?.[1]) return m[1].trim().replace(/[?.!,]+$/g, '');
  }
  return null;
}

async function lookupFamily(env, alias) {
  return serviceRest(env, 'rpc/ask_collectish_public_card_lookup_v1', {
    method: 'POST',
    body: { p_query: alias, p_limit: 24 },
  });
}

async function recentSignals(env, alias) {
  const cutoff = new Date(Date.now() - 21 * 86400000).toISOString();
  const term = encodeURIComponent(`*${alias}*`);
  return serviceRest(env,
    `market_intel_items?observed_at=gte.${encodeURIComponent(cutoff)}&or=(title.ilike.${term},summary.ilike.${term})&select=intel_id,source_name,source_url,title,summary,published_at,observed_at&order=observed_at.desc&limit=20`
  ).catch(() => []);
}

async function currentPrices(env, rows) {
  const skus = [...new Set((rows || []).map((r) => String(r.sku_id || '')).filter(Boolean))];
  if (!skus.length) return [];
  return serviceRest(env,
    `tcgplayer_official_sku_price_current?sku_id=in.(${skus.join(',')})&select=sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at`
  ).catch(() => []);
}

async function externalResearch(env, job, alias, rows) {
  const primary = (rows || []).find((r) => r.source === 'scout_card_catalog' && r.scryfall_id) || rows?.[0];
  if (!primary) return null;
  const products = [...new Set((rows || []).map((r) => `${r.card_name} [${r.set_code} #${r.collector_number || '?'} ${r.printing || ''}]`))].join('; ');
  const response = await fetch(`${supabaseBase(env)}/functions/v1/ask-collectish-api`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'chat', client: 'discord_guest', guest: true,
      message: `Research externally why ${alias} Magic: The Gathering cards spiked. Treat this as a card-family move across these known products/printings: ${products}. Identify the strongest common catalyst and compare its timing to the observed market movement. Do not ask me to choose a printing.`,
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
  return response.ok ? data : null;
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function clip(v, max = 1000) {
  const s = String(v || '').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function buildPayload(alias, rows, prices, signals, research) {
  const priceBySku = new Map((prices || []).map((p) => [String(p.sku_id), p]));
  const seen = new Set();
  const lines = [];
  for (const row of rows || []) {
    const key = `${row.product_id}|${row.sku_id}|${row.printing}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = priceBySku.get(String(row.sku_id));
    lines.push(`• **${row.card_name}** — ${row.set_code} #${row.collector_number || '?'} · ${row.printing || 'printing'}${p ? ` · Market ${money(p.market_price)} · Low ${money(p.lowest_listing_price ?? p.low_price)}` : ''}`);
  }

  const signalLines = (signals || []).slice(0, 7).map((s) => {
    const title = s.source_url ? `[${s.title || s.source_name}](${s.source_url})` : (s.title || s.source_name || 'Signal');
    return `• ${title}${s.summary ? `\n  ${s.summary}` : ''}`;
  });
  const researchText = String(research?.response || research?.answer || '').trim();
  const fields = [
    { name: 'Matched MTG products / printings', value: clip(lines.join('\n')), inline: false },
    { name: 'Market signals', value: signalLines.length ? clip(signalLines.join('\n')) : 'No recent named Signals matched this alias.', inline: false },
  ];
  if (researchText) fields.push({ name: 'External research', value: clip(researchText), inline: false });
  return {
    content: '',
    embeds: [{
      title: `${alias} — card-family market move`,
      description: `Resolved ${seen.size} MTG SKU/printing entr${seen.size === 1 ? 'y' : 'ies'} and investigated the family together.`,
      fields,
      footer: { text: 'Collectish public card-family identity + Signals + external research' },
    }],
    components: [],
  };
}

async function handleFamilyMove(env, job, message) {
  const alias = moveAlias(job.question);
  if (!alias) return false;

  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return true;
  }

  try {
    await editOriginalDiscord(job, { content: `🔎 Delvin is tracing the ${alias} move across MTG printings…`, embeds: [], components: [] }).catch(() => null);
    const rows = await lookupFamily(env, alias);
    if (!Array.isArray(rows) || !rows.length) throw new Error(`No MTG card-family match found for ${alias}`);
    const [prices, signals, research] = await Promise.all([
      currentPrices(env, rows),
      recentSignals(env, alias),
      externalResearch(env, job, alias, rows),
    ]);
    await editOriginalDiscord(job, buildPayload(alias, rows, prices, signals, research));
    await updateDelivery(env, job.interaction_id, {
      response_text: String(research?.response || research?.answer || `${alias}: ${signals?.length || 0} recent Signals across ${rows.length} known entries`).slice(0, 1900),
      status: 'completed', completed_at: new Date().toISOString(), error_text: null,
    });
    message.ack();
    return true;
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 500);
    await editOriginalDiscord(job, { content: `Delvin couldn't finish the card-family market investigation: ${detail}`, embeds: [], components: [] }).catch(() => null);
    await updateDelivery(env, job.interaction_id, { status: 'failed', error_text: detail, completed_at: new Date().toISOString() }).catch(() => null);
    message.ack();
    return true;
  }
}

export default {
  fetch(request, env, ctx) { return entry.fetch(request, env, ctx); },
  async queue(batch, env, ctx) {
    const fallback = [];
    for (const message of batch.messages) {
      const job = message.body || {};
      const alias = moveAlias(job.question);
      const isPrivate = String(job.response_visibility || '').toLowerCase() === 'ephemeral';
      if (!alias || isPrivate) {
        fallback.push(message);
        continue;
      }
      await handleFamilyMove(env, job, message);
    }
    if (fallback.length) return entry.queue({ messages: fallback }, env, ctx);
  },
};
