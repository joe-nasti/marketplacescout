import entry from './discord-ask-entry-v9.mjs';

const DISCORD_API = 'https://discord.com/api/v10';
const TCG_INFINITE = 'https://infinite-api.tcgplayer.com';
const QUICKCHART = 'https://quickchart.io/chart';
const CHART_FILE = 'tcgplayer-marketplace-history.png';

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

async function editOriginalDiscordWithImage(job, payload, imageBlob) {
  const form = new FormData();
  const body = {
    allowed_mentions: { parse: [] },
    ...payload,
    attachments: [{ id: 0, filename: CHART_FILE }],
  };
  form.append('payload_json', JSON.stringify(body));
  form.append('files[0]', imageBlob, CHART_FILE);
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, {
    method: 'PATCH',
    body: form,
  });
  if (!response.ok) throw new Error(`Discord multipart edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
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

function isPriceHistoryIntent(question) {
  const q = String(question || '');
  return /\b(?:price|market|sales?|sale)\s+history\b|\b(?:graph|chart|plot|visuali[sz]e)\b.*\b(?:price|market|sales?)\b|\b(?:price|market|sales?)\b.*\b(?:graph|chart|plot|visuali[sz]e)\b/i.test(q);
}

function requestedDays(question) {
  const q = String(question || '');
  const m = q.match(/\b(?:last|past)\s+(\d+)\s*(day|week|month|year)s?\b/i);
  if (m) {
    const n = Math.max(1, Number(m[1]) || 1);
    const unit = m[2].toLowerCase();
    if (unit === 'day') return Math.min(730, n);
    if (unit === 'week') return Math.min(730, n * 7);
    if (unit === 'month') return Math.min(730, n * 30);
    if (unit === 'year') return Math.min(730, n * 365);
  }
  if (/\b6\s*months?\b/i.test(q)) return 180;
  if (/\b3\s*months?\b/i.test(q)) return 90;
  if (/\b1\s*year\b|\b12\s*months?\b/i.test(q)) return 365;
  return 180;
}

async function resolveSharedContext(env, question) {
  const rows = await serviceRest(env, 'rpc/ask_resolve_card_context', {
    method: 'POST',
    body: { p_question: question },
  }).catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

async function getHistory(env, resolved, days) {
  return serviceRest(env, 'rpc/ask_card_price_history_v1', {
    method: 'POST',
    body: {
      p_product_id: resolved?.product_id || null,
      p_sku_id: resolved?.sku_id || null,
      p_days: days,
    },
  });
}

async function cacheOwnerForDiscord(env, discordUserId) {
  if (!discordUserId) return null;
  const linked = await serviceRest(
    env,
    `discord_collectish_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=user_id&limit=1`,
  ).catch(() => []);
  if (linked?.[0]?.user_id) return linked[0].user_id;
  const guest = await serviceRest(
    env,
    `discord_guest_auth_sessions?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=anonymous_user_id&limit=1`,
  ).catch(() => []);
  return guest?.[0]?.anonymous_user_id || null;
}

function matchingSkuResult(result, skuId) {
  const wanted = String(skuId || '');
  return (Array.isArray(result) ? result : []).find((row) => String(row?.skuId || '') === wanted) || null;
}

function bucketsFromSkuResult(row) {
  return (Array.isArray(row?.buckets) ? row.buckets : []).map((b) => ({
    bucket_start_date: String(b?.bucketStartDate || '').slice(0, 10),
    market_price: b?.marketPrice ?? null,
    low_sale_price: b?.lowSalePrice ?? null,
    high_sale_price: b?.highSalePrice ?? null,
    low_sale_price_with_shipping: b?.lowSalePriceWithShipping ?? null,
    high_sale_price_with_shipping: b?.highSalePriceWithShipping ?? null,
    quantity_sold: b?.quantitySold ?? null,
    transaction_count: b?.transactionCount ?? null,
    source: 'tcgplayer_marketplace_live',
  })).filter((b) => b.bucket_start_date).sort((a, b) => a.bucket_start_date.localeCompare(b.bucket_start_date));
}

async function fetchTcgMarketplaceHistory(resolved, days) {
  const ranges = days > 95 ? ['year', 'quarter'] : ['quarter'];
  const attempts = [];
  for (const range of ranges) {
    const url = `${TCG_INFINITE}/price/history/${encodeURIComponent(String(resolved.product_id))}/detailed?range=${range}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'MarketplaceScout/1.0 (+TCGplayer marketplace history)' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const raw = await response.text();
      if (!response.ok) {
        attempts.push({ range, ok: false, error: `HTTP ${response.status}` });
        continue;
      }
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      const result = Array.isArray(data?.result) ? data.result : [];
      const sku = matchingSkuResult(result, resolved.sku_id);
      const buckets = bucketsFromSkuResult(sku);
      attempts.push({ range, ok: true, bucket_count: buckets.length });
      if (buckets.length) return { ok: true, range, result, buckets, attempts };
    } catch (error) {
      attempts.push({ range, ok: false, error: String(error?.message || error).slice(0, 160) });
    }
  }
  return { ok: false, range: null, result: [], buckets: [], attempts };
}

async function cacheLiveMarketplaceHistory(env, job, resolved, live) {
  const owner = await cacheOwnerForDiscord(env, job.discord_user_id);
  if (!owner || !Array.isArray(live?.result) || !live.result.length) return false;
  await serviceRest(env, 'rpc/apply_marketplace_sales_history', {
    method: 'POST',
    body: {
      p_user_id: owner,
      p_product_id: String(resolved.product_id),
      p_result: live.result,
      p_source: `tcgplayer_marketplace_live_${live.range || 'unknown'}`,
    },
  });
  return true;
}

function dayDiff(first, last) {
  const a = Date.parse(`${first}T00:00:00Z`);
  const b = Date.parse(`${last}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86400000) + 1;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function marketplacePayload(history, requested, fetchedLive = false, fetchRange = null) {
  const card = history?.card || {};
  const name = card.card_name || 'This card';
  const label = [card.set_code, card.printing, card.condition, card.language].filter(Boolean).join(' · ');
  const sales = Array.isArray(history?.sales_points) ? history.sales_points : [];
  const first = sales[0] || null;
  const last = sales.at(-1) || null;
  const coverage = first && last ? dayDiff(first.bucket_start_date, last.bucket_start_date) : null;
  const qty = sales.reduce((sum, row) => sum + Number(row.quantity_sold || 0), 0);
  const tx = sales.reduce((sum, row) => sum + Number(row.transaction_count || 0), 0);
  const firstMarket = first?.market_price;
  const lastMarket = last?.market_price;
  const change = Number(firstMarket) > 0 && Number.isFinite(Number(lastMarket))
    ? ((Number(lastMarket) - Number(firstMarket)) / Number(firstMarket)) * 100
    : null;

  const fields = [
    {
      name: 'Data source',
      value: '**TCGplayer Marketplace only.** This is not Collectish sales history, Seller History, or your account sales. Collectish only retrieved/cached and rendered the marketplace data.',
      inline: false,
    },
  ];
  if (sales.length) {
    fields.push({
      name: 'Marketplace sales',
      value: `${sales.length} dated 3-day buckets · ${qty.toLocaleString()} copies · ${tx.toLocaleString()} transactions`,
      inline: false,
    });
    fields.push({
      name: 'Marketplace price',
      value: `${money(firstMarket)} → ${money(lastMarket)}${change == null ? '' : ` · ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}`,
      inline: false,
    });
    const coverageText = `${first.bucket_start_date} → ${last.bucket_start_date}${coverage ? ` (~${coverage} days)` : ''}`;
    fields.push({
      name: 'Coverage',
      value: coverage != null && coverage + 7 < requested
        ? `Requested ~${requested} days; TCGplayer Marketplace returned ${coverageText}. The chart does **not** imply coverage outside those dates.`
        : coverageText,
      inline: false,
    });
  } else {
    fields.push({
      name: 'Availability',
      value: `TCGplayer Marketplace did not return dated sales buckets for the resolved SKU${fetchRange ? ` using the ${fetchRange} range` : ''}.`,
      inline: false,
    });
  }

  const embed = {
    title: `${name} — TCGplayer Marketplace history`,
    description: `Resolved automatically to **${label || 'the default NM English printing'}**.${fetchedLive ? ' Fetched live because no cached marketplace series was available.' : ''}`,
    fields,
    footer: { text: 'Source: TCGplayer Marketplace historical sales buckets • Collectish is retrieval/cache/presentation only' },
  };
  if (sales.length) embed.image = { url: `attachment://${CHART_FILE}` };
  return { content: '', embeds: [embed], components: [] };
}

async function renderChart(history) {
  const card = history?.card || {};
  const sales = Array.isArray(history?.sales_points) ? history.sales_points : [];
  if (!sales.length) return null;
  const labels = sales.map((p) => p.bucket_start_date);
  const prices = sales.map((p) => Number.isFinite(Number(p.market_price)) ? Number(p.market_price) : null);
  const copies = sales.map((p) => Number.isFinite(Number(p.quantity_sold)) ? Number(p.quantity_sold) : 0);
  const chart = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'line', label: 'TCGplayer Market Price', data: prices, yAxisID: 'price', fill: false, pointRadius: 1, borderWidth: 2 },
        { type: 'bar', label: 'TCGplayer Marketplace Copies Sold', data: copies, yAxisID: 'sales', borderWidth: 0 },
      ],
    },
    options: {
      responsive: false,
      title: { display: true, text: `${card.card_name || 'Card'} — TCGplayer Marketplace history` },
      legend: { display: true },
      scales: {
        xAxes: [{ ticks: { maxTicksLimit: 12, autoSkip: true } }],
        yAxes: [
          { id: 'price', position: 'left', scaleLabel: { display: true, labelString: 'Market price (USD)' } },
          { id: 'sales', position: 'right', gridLines: { drawOnChartArea: false }, scaleLabel: { display: true, labelString: 'Copies sold per 3-day bucket' }, ticks: { beginAtZero: true } },
        ],
      },
    },
  };
  try {
    const response = await fetch(QUICKCHART, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'image/png' },
      body: JSON.stringify({ width: 1000, height: 540, format: 'png', backgroundColor: 'white', chart }),
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size ? blob : null;
  } catch {
    return null;
  }
}

async function handlePriceHistory(env, job, message) {
  const resolved = await resolveSharedContext(env, job.question);
  if (!resolved?.product_id && !resolved?.sku_id) return false;
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return true;
  }

  const requested = requestedDays(job.question);
  await editOriginalDiscord(job, { content: '🔎 Delvin is fetching TCGplayer Marketplace history…', embeds: [], components: [] }).catch(() => null);

  let history = await getHistory(env, resolved, requested);
  let live = null;
  let fetchedLive = false;
  if (!Array.isArray(history?.sales_points) || !history.sales_points.length) {
    live = await fetchTcgMarketplaceHistory(resolved, requested);
    if (live.ok) {
      fetchedLive = true;
      const cached = await cacheLiveMarketplaceHistory(env, job, resolved, live).catch(() => false);
      if (cached) {
        history = await getHistory(env, resolved, requested).catch(() => history);
      }
      if (!Array.isArray(history?.sales_points) || !history.sales_points.length) {
        history = {
          ...(history || {}),
          available: true,
          days: requested,
          card: history?.card && Object.keys(history.card).length ? history.card : resolved,
          sales_points: live.buckets,
          sales_point_count: live.buckets.length,
          sales_source: 'tcgplayer_marketplace',
        };
      }
    }
  }

  const payload = marketplacePayload(history, requested, fetchedLive, live?.range || null);
  const chart = await renderChart(history);
  if (chart && Array.isArray(history?.sales_points) && history.sales_points.length) {
    await editOriginalDiscordWithImage(job, payload, chart).catch(async () => editOriginalDiscord(job, { ...payload, embeds: payload.embeds.map((e) => ({ ...e, image: undefined })) }));
  } else {
    if (payload.embeds?.[0]?.image) delete payload.embeds[0].image;
    await editOriginalDiscord(job, payload);
  }

  await updateDelivery(env, job.interaction_id, {
    response_text: `${history?.card?.card_name || resolved.card_name || 'card'} TCGplayer Marketplace history`,
    status: 'completed',
    completed_at: new Date().toISOString(),
    error_text: live && !live.ok ? `TCGplayer Marketplace live fetch returned no buckets: ${JSON.stringify(live.attempts).slice(0, 500)}` : null,
  });
  message.ack();
  return true;
}

async function handleQueue(batch, env, ctx) {
  const fallback = [];
  for (const message of batch.messages) {
    const job = message.body || {};
    if (!isPriceHistoryIntent(job.question)) {
      fallback.push(message);
      continue;
    }
    try {
      const handled = await handlePriceHistory(env, job, message);
      if (!handled) fallback.push(message);
    } catch (error) {
      console.error('discord ask v10 TCGplayer marketplace history failed', {
        interaction_id: job.interaction_id,
        error: String(error?.message || error),
      });
      fallback.push(message);
    }
  }
  if (fallback.length) return entry.queue({ messages: fallback }, env, ctx);
}

export default {
  fetch(request, env, ctx) {
    return entry.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return handleQueue(batch, env, ctx);
  },
};
