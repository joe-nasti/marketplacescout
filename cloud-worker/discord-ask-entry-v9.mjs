import entry from './discord-ask-entry-v8.mjs';

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

function isPriceHistoryIntent(question) {
  return /\b(?:price|market)\s+history\b|\b(?:graph|chart|plot|visuali[sz]e)\b.*\b(?:price|market)\b|\b(?:price|market)\b.*\b(?:graph|chart|plot|visuali[sz]e)\b/i.test(String(question || ''));
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

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function historyPayload(history) {
  const card = history?.card || {};
  const name = card.card_name || 'This card';
  const label = [card.set_code, card.printing].filter(Boolean).join(' ');
  const pricePoints = Array.isArray(history?.price_points) ? history.price_points : [];
  const salesPoints = Array.isArray(history?.sales_points) ? history.sales_points : [];
  const days = Number(history?.days || 180);

  if (!pricePoints.length && !salesPoints.length) {
    return {
      content: '',
      embeds: [{
        title: `${name} — ${days}-day history`,
        description: `Resolved automatically to **${label || 'the default NM English printing'}**.`,
        fields: [
          { name: 'Price history', value: 'Collectish does not currently have stored TCGplayer price-history points for this SKU.', inline: false },
          { name: 'Sales history', value: 'Collectish does not currently have stored sales-bucket history for this SKU.', inline: false },
          { name: 'What this means', value: 'The card was found correctly; the missing result is the historical time series itself, not the card identity. Delvin will not ask you to pick a printing just to unlock data that is not stored.', inline: false },
        ],
        footer: { text: 'Collectish shared price-history service' },
      }],
      components: [],
    };
  }

  const first = pricePoints[0] || null;
  const last = pricePoints.at(-1) || null;
  const firstMarket = first?.market_price;
  const lastMarket = last?.market_price;
  let change = null;
  if (Number(firstMarket) > 0 && Number.isFinite(Number(lastMarket))) change = ((Number(lastMarket) - Number(firstMarket)) / Number(firstMarket)) * 100;

  const fields = [];
  if (pricePoints.length) {
    fields.push({
      name: 'Price history',
      value: `${pricePoints.length} stored points · ${money(firstMarket)} → ${money(lastMarket)}${change == null ? '' : ` · ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}`,
      inline: false,
    });
  }
  if (salesPoints.length) {
    const qty = salesPoints.reduce((sum, row) => sum + Number(row.quantity_sold || 0), 0);
    const tx = salesPoints.reduce((sum, row) => sum + Number(row.transaction_count || 0), 0);
    fields.push({ name: 'Sales history', value: `${salesPoints.length} buckets · ${qty.toLocaleString()} copies · ${tx.toLocaleString()} transactions`, inline: false });
  }
  fields.push({ name: 'Chart', value: 'A Discord inline chart renderer is the next presentation layer; the shared service now returns the real time-series points deterministically.', inline: false });

  return {
    content: '',
    embeds: [{
      title: `${name} — ${days}-day history`,
      description: `Resolved automatically to **${label || 'the default NM English printing'}**.`,
      fields,
      footer: { text: 'Collectish shared price-history service' },
    }],
    components: [],
  };
}

async function handlePriceHistory(env, job, message) {
  const resolved = await resolveSharedContext(env, job.question);
  if (!resolved?.product_id && !resolved?.sku_id) return false;

  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return true;
  }

  await editOriginalDiscord(job, { content: '🔎 Delvin is digging through Collectish…', embeds: [], components: [] }).catch(() => null);
  const history = await getHistory(env, resolved, requestedDays(job.question));
  const payload = historyPayload(history);
  await editOriginalDiscord(job, payload);
  await updateDelivery(env, job.interaction_id, {
    response_text: `${history?.card?.card_name || resolved.card_name || 'card'} price history`,
    status: 'completed',
    completed_at: new Date().toISOString(),
    error_text: null,
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
      console.error('discord ask v9 price history failed', {
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
