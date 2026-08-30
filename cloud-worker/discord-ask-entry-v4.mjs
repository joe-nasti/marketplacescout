import entry from './discord-ask-entry-v3.mjs';

const DISCORD_API = 'https://discord.com/api/v10';

function supabaseBase(env) {
  return String(env.SUPABASE_URL || '').replace(/\/$/, '');
}

function clean(value, max = 2000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
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

async function updateDelivery(env, interactionId, patch) {
  return serviceRest(env, `discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(interactionId)}`, {
    method: 'PATCH',
    body: { ...patch, updated_at: new Date().toISOString() },
  });
}

async function claimDelivery(env, job) {
  const rows = await serviceRest(env, 'rpc/claim_discord_ask_delivery', {
    method: 'POST',
    body: { p_interaction_id: job.interaction_id, p_discord_user_id: job.discord_user_id },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function linkForDiscord(env, discordUserId) {
  const rows = await serviceRest(env, `discord_collectish_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=id&limit=1`);
  return rows?.[0] || null;
}

function isMoveIntent(question) {
  return /\b(?:moving|spiking|rising|price spike|price move)\b|\bwhy\s+did\b.*\b(?:move|spike|jump|rise)\b/i.test(question || '');
}

function extractCardName(question) {
  const q = clean(question, 500);
  const patterns = [
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

async function catalogByExactName(env, name) {
  const select = 'sku_id,product_id,scryfall_id,card_name,set_code,collector_number,printing,condition,language';
  return serviceRest(env, `scout_card_catalog?card_name=eq.${encodeURIComponent(name)}&select=${select}&limit=50`).catch(() => []);
}

async function scryfallCanonicalName(name) {
  try {
    const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'collectish-discord/1.0' },
    });
    if (!response.ok) return null;
    const card = await response.json();
    return clean(card?.name, 160) || null;
  } catch {
    return null;
  }
}

async function resolveCard(env, question) {
  const asked = extractCardName(question);
  if (!asked) return null;

  let rows = await catalogByExactName(env, asked);
  let canonical = asked;

  if (!Array.isArray(rows) || !rows.length) {
    canonical = await scryfallCanonicalName(asked);
    if (canonical) rows = await catalogByExactName(env, canonical);
  }

  if (!Array.isArray(rows) || !rows.length) {
    const select = 'sku_id,product_id,scryfall_id,card_name,set_code,collector_number,printing,condition,language';
    rows = await serviceRest(
      env,
      `scout_card_catalog?card_name=ilike.*${encodeURIComponent(asked)}*&select=${select}&limit=50`,
    ).catch(() => []);
  }

  if (!Array.isArray(rows) || !rows.length) return null;
  const exact = rows.filter((row) => String(row.card_name || '').toLowerCase() === String(canonical || asked).toLowerCase());
  const pool = exact.length ? exact : rows;
  const nmEnglish = pool.filter((row) =>
    String(row.condition || '').toUpperCase() === 'NEAR MINT' &&
    String(row.language || '').toUpperCase() === 'ENGLISH'
  );
  return {
    name: pool[0].card_name,
    printings: (nmEnglish.length ? nmEnglish : pool).slice(0, 20),
  };
}

function dollars(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—';
}

async function marketMovePayload(env, resolved) {
  const cardName = resolved.name;
  const skuIds = [...new Set(resolved.printings.map((row) => String(row.sku_id || '')).filter(Boolean))];
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const inSkus = skuIds.join(',');

  const [current, history, signalSales, mentions] = await Promise.all([
    inSkus ? serviceRest(env, `tcgplayer_official_sku_price_current?sku_id=in.(${inSkus})&select=sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at`).catch(() => []) : [],
    inSkus ? serviceRest(env, `tcgplayer_official_sku_price_history?sku_id=in.(${inSkus})&observed_at=gte.${encodeURIComponent(cutoff)}&select=sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at&order=observed_at.asc&limit=2000`).catch(() => []) : [],
    serviceRest(env, `marketplace_signal_sku_sales_response?card_name=eq.${encodeURIComponent(cardName)}&select=set_code,product_id,sku_id,printing,signal_first_at,signal_last_at,average_daily_quantity_sold,average_daily_transaction_count,transaction_velocity_lift_30d_pct,quantity_velocity_lift_matched_pct,evidence_level,evidence_status,evidence_confidence,signal_market_price,latest_market_price,market_price_change_pct,latest_bucket_date&order=signal_last_at.desc.nullslast&limit=20`).catch(() => []),
    serviceRest(env, `market_intel_card_mentions?card_name=eq.${encodeURIComponent(cardName)}&select=intel_id,card_name,product_id,set_code,confidence,resolution,created_at&order=created_at.desc&limit=20`).catch(() => []),
  ]);

  const intelIds = [...new Set((mentions || []).map((row) => row.intel_id).filter(Boolean))].slice(0, 20);
  const intel = intelIds.length
    ? await serviceRest(env, `market_intel_items?intel_id=in.(${intelIds.join(',')})&select=intel_id,source_type,source_name,source_url,title,summary,claim_type,direction,signal_stage,confidence,published_at,observed_at&order=published_at.desc.nullslast&limit=20`).catch(() => [])
    : [];

  const printingBySku = new Map(resolved.printings.map((row) => [String(row.sku_id), row]));
  const historyBySku = new Map();
  for (const row of history || []) {
    const key = String(row.sku_id);
    if (!historyBySku.has(key)) historyBySku.set(key, []);
    historyBySku.get(key).push(row);
  }

  const priceRows = (current || []).map((row) => {
    const key = String(row.sku_id);
    const hist = historyBySku.get(key) || [];
    const first = hist.find((item) => Number.isFinite(Number(item.market_price))) || null;
    const latest = Number(row.market_price);
    const start = Number(first?.market_price);
    const change = Number.isFinite(latest) && Number.isFinite(start) && start > 0 ? ((latest - start) / start) * 100 : null;
    return { row, printing: printingBySku.get(key), change, latest };
  }).sort((a, b) => Math.abs(Number(b.change || 0)) - Math.abs(Number(a.change || 0)));

  const priceLines = priceRows.slice(0, 6).map((item) => {
    const p = item.printing || {};
    const label = `${p.set_code || 'SET'} ${p.printing || ''}`.trim();
    const delta = Number.isFinite(item.change) ? ` · ${pct(item.change)} vs ~30d` : '';
    return `**${label}** · Market ${dollars(item.latest)}${delta}\nLow ${dollars(item.row.lowest_listing_price ?? item.row.low_price)}${item.row.direct_low_price != null ? ` · Direct ${dollars(item.row.direct_low_price)}` : ''}`;
  });

  const salesLines = (signalSales || []).slice(0, 5).map((row) => {
    const bits = [
      `${row.set_code || 'SET'} ${row.printing || ''}`.trim(),
      row.average_daily_quantity_sold != null ? `${Number(row.average_daily_quantity_sold).toFixed(1)} cards/day` : null,
      row.transaction_velocity_lift_30d_pct != null ? `tx velocity ${pct(row.transaction_velocity_lift_30d_pct)}` : null,
      row.market_price_change_pct != null ? `signal→latest ${pct(row.market_price_change_pct)}` : null,
      row.evidence_status ? String(row.evidence_status).replace(/_/g, ' ') : null,
    ].filter(Boolean);
    return `• ${bits.join(' · ')}`;
  });

  const intelById = new Map((intel || []).map((row) => [row.intel_id, row]));
  const catalystLines = [];
  const buttons = [];
  const seen = new Set();
  for (const mention of mentions || []) {
    const item = intelById.get(mention.intel_id);
    if (!item) continue;
    const title = clean(item.title || item.summary || item.source_name || 'Signal', 110);
    const source = clean(item.source_name || item.source_type || 'Signal', 50);
    const date = String(item.published_at || item.observed_at || mention.created_at || '').slice(0, 10);
    catalystLines.push(item.source_url ? `• [${title}](${item.source_url}) — ${source}${date ? ` · ${date}` : ''}` : `• ${title} — ${source}${date ? ` · ${date}` : ''}`);
    if (item.source_url && !seen.has(item.source_url) && buttons.length < 3) {
      seen.add(item.source_url);
      buttons.push({ type: 2, style: 5, label: `Open ${source}`.slice(0, 80), url: item.source_url });
    }
    if (catalystLines.length >= 5) break;
  }

  const moved = priceRows.filter((row) => Number.isFinite(row.change) && Math.abs(row.change) >= 5);
  let read = 'Collectish does not yet have enough 30-day price history to confidently characterize the move.';
  if (moved.length >= 2) read = `The move is visible across **${moved.length} printings**, which points more toward card-level demand than one isolated listing.`;
  else if (moved.length === 1) read = `The measurable move is currently **printing-specific** (${moved[0].printing?.set_code || 'one printing'}).`;
  if (catalystLines.length && salesLines.length) read += ' Catalyst evidence and sales-response data both exist, giving the move stronger corroboration.';
  else if (catalystLines.length) read += ' A recent catalyst is attached, but sales confirmation is limited.';
  else if (salesLines.length) read += ' Sales-response data exists, but no named recent content catalyst is attached yet.';

  return {
    content: '',
    embeds: [{
      title: `${cardName} — market move`,
      description: `Automatically resolved as Magic: The Gathering. Comparing ${resolved.printings.length} known NM English printing${resolved.printings.length === 1 ? '' : 's'}.`,
      fields: [
        { name: 'Price action', value: priceLines.length ? priceLines.join('\n') : 'No current TCGplayer price rows are available for the resolved printings.', inline: false },
        { name: 'Sales confirmation', value: salesLines.length ? salesLines.join('\n') : 'No signal-linked sales response is currently available.', inline: false },
        { name: 'Catalysts / Signals', value: catalystLines.length ? catalystLines.join('\n') : 'No recent named Collectish catalyst is attached to this card yet.', inline: false },
        { name: 'Read', value: read, inline: false },
      ],
      footer: { text: 'Collectish price history + sales response + Signals provenance.' },
    }],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
  };
}

async function handleMove(env, job, resolved) {
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) return true;
  await editOriginalDiscord(job, { content: '🔎 Delvin is digging through Collectish…', embeds: [], components: [] }).catch(() => null);
  const payload = await marketMovePayload(env, resolved);
  await updateDelivery(env, job.interaction_id, { response_text: `${resolved.name} market move` });
  await editOriginalDiscord(job, payload);
  await updateDelivery(env, job.interaction_id, { status: 'completed', completed_at: new Date().toISOString(), error_text: null });
  return true;
}

async function handleQueue(batch, env, ctx) {
  for (const message of batch.messages) {
    const job = message.body || {};
    try {
      if (!isMoveIntent(job.question)) {
        await entry.queue({ messages: [message] }, env, ctx);
        continue;
      }
      const linked = job.discord_user_id ? await linkForDiscord(env, job.discord_user_id) : null;
      if (linked) {
        await entry.queue({ messages: [message] }, env, ctx);
        continue;
      }
      const resolved = await resolveCard(env, job.question);
      if (!resolved) {
        await editOriginalDiscord(job, {
          content: `I could not resolve that as a Magic card after checking Collectish and Scryfall. Try the exact card name.`,
          embeds: [],
          components: [],
        }).catch(() => null);
        message.ack();
        continue;
      }
      await handleMove(env, job, resolved);
      message.ack();
    } catch (error) {
      console.error('discord ask v4 market resolution failed', {
        interaction_id: job.interaction_id,
        error: String(error?.message || error),
      });
      await entry.queue({ messages: [message] }, env, ctx).catch(() => null);
    }
  }
}

export default {
  fetch(request, env, ctx) {
    return entry.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return handleQueue(batch, env, ctx);
  },
};
