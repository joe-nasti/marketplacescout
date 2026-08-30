import entry from './discord-ask-entry-v13.mjs';

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

function isBareCardLookup(question) {
  const q = String(question || '').trim();
  return q.length <= 140 && (
    /^[^?]+\s+cards?\??$/i.test(q)
    || /^show\s+me\s+[^?]+\s+cards?\??$/i.test(q)
  );
}

function cleanQuery(question) {
  return String(question || '')
    .trim()
    .replace(/^show\s+me\s+/i, '')
    .replace(/\s+cards?\??$/i, '')
    .trim();
}

function printingLabel(row) {
  return [row.set_code, row.collector_number ? `#${row.collector_number}` : null, row.printing, row.condition, row.language]
    .filter(Boolean)
    .join(' · ');
}

function lookupPayload(query, rows) {
  const byProduct = new Map();
  for (const row of rows) {
    const key = String(row.product_id || `${row.card_name}|${row.set_code}`);
    if (!byProduct.has(key)) byProduct.set(key, { name: row.card_name, rows: [] });
    byProduct.get(key).rows.push(row);
  }

  const fields = [];
  for (const group of [...byProduct.values()].slice(0, 8)) {
    const lines = group.rows.slice(0, 8).map((row) => {
      const source = row.source === 'marketplace_scan_rows' ? 'Marketplace scan' : 'Scout catalog';
      return `• ${printingLabel(row)} · SKU ${row.sku_id || '—'} · Product ${row.product_id || '—'} · ${source}`;
    });
    fields.push({ name: group.name.slice(0, 256), value: lines.join('\n').slice(0, 1020), inline: false });
  }

  return {
    content: '',
    embeds: [{
      title: `${query} — known MTG matches`,
      description: `Resolved from Collectish card identity before Scout text search. Found ${rows.length} known SKU/printing match${rows.length === 1 ? '' : 'es'} across ${byProduct.size} product${byProduct.size === 1 ? '' : 's'}.`,
      fields,
      footer: { text: 'Collectish public MTG identity lookup • Scout catalog + marketplace scan index' },
    }],
    components: [],
  };
}

async function handleLookup(env, job, message) {
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return;
  }

  const query = cleanQuery(job.question);
  try {
    await editOriginalDiscord(job, { content: '🔎 Delvin is resolving MTG card identities…', embeds: [], components: [] }).catch(() => null);
    const rows = await serviceRest(env, 'rpc/ask_collectish_public_card_lookup_v1', {
      method: 'POST',
      body: { p_query: query, p_limit: 24 },
    });
    if (!Array.isArray(rows) || !rows.length) {
      await editOriginalDiscord(job, { content: `I couldn't resolve **${query}** to a known MTG card in Collectish.`, embeds: [], components: [] });
      await updateDelivery(env, job.interaction_id, {
        response_text: `No known MTG match for ${query}`,
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_text: null,
      });
      message.ack();
      return;
    }

    await editOriginalDiscord(job, lookupPayload(query, rows));
    await updateDelivery(env, job.interaction_id, {
      response_text: `Resolved ${query}: ${rows.map((r) => `${r.card_name} ${r.set_code} ${r.printing}`).slice(0, 10).join(' | ')}`.slice(0, 1900),
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_text: null,
    });
    message.ack();
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 500);
    await editOriginalDiscord(job, { content: `Delvin couldn't finish the card lookup: ${detail}`, embeds: [], components: [] }).catch(() => null);
    await updateDelivery(env, job.interaction_id, { status: 'failed', error_text: detail, completed_at: new Date().toISOString() }).catch(() => null);
    message.ack();
  }
}

async function handleQueue(batch, env, ctx) {
  const fallback = [];
  for (const message of batch.messages) {
    const job = message.body || {};
    const isPrivate = String(job.response_visibility || '').toLowerCase() === 'ephemeral';
    if (isPrivate || !isBareCardLookup(job.question)) {
      fallback.push(message);
      continue;
    }
    await handleLookup(env, job, message);
  }
  if (fallback.length) return entry.queue({ messages: fallback }, env, ctx);
}

export default {
  fetch(request, env, ctx) { return entry.fetch(request, env, ctx); },
  queue(batch, env, ctx) { return handleQueue(batch, env, ctx); },
};
