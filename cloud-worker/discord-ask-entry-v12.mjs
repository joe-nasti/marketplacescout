import entry from './discord-ask-entry-v11.mjs';

const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_WINDOW_MS = 30 * 60 * 1000;

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

function isSpecRecommendation(question) {
  const q = String(question || '');
  return /\b(?:top|best|good|which|what)\b.*\b(?:cards?|specs?)\b.*\b(?:spec|buy|pick|target|watch)\b/i.test(q)
    || /\b(?:spec|speculate)\s+(?:on|into)\b/i.test(q)
    || /\bcards?\s+to\s+spec\b/i.test(q);
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
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.ask_session_id || !row?.updated_at) return null;
  const age = Date.now() - Date.parse(row.updated_at);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_WINDOW_MS) return null;
  return row;
}

async function saveBinding(env, job, sessionId) {
  if (!sessionId) return;
  await serviceRest(env, 'rpc/upsert_discord_ask_binding', {
    method: 'POST',
    body: {
      p_discord_user_id: String(job.discord_user_id || ''),
      p_guild_id: job.guild_id ? String(job.guild_id) : null,
      p_channel_id: String(job.channel_id || ''),
      p_thread_id: job.thread_id ? String(job.thread_id) : null,
      p_ask_session_id: String(sessionId),
      p_interaction_id: job.interaction_id ? String(job.interaction_id) : null,
    },
  });
}

async function ensureGuestSession(env, job, binding) {
  if (binding?.ask_session_id) return binding.ask_session_id;
  const response = await fetch(`${supabaseBase(env)}/functions/v1/ask-collectish-api`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'session.create',
      client: 'discord_guest',
      guest: true,
      title: String(job.question || 'Spec recommendations').slice(0, 90),
      context: {
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
  if (!response.ok) throw new Error(data?.error || `Ask session create ${response.status}`);
  return data?.session?.id || data?.session_id || null;
}

async function guestOwner(env, discordUserId) {
  const rows = await serviceRest(
    env,
    `discord_guest_auth_sessions?discord_user_id=eq.${encodeURIComponent(String(discordUserId || ''))}&select=anonymous_user_id&limit=1`,
  ).catch(() => []);
  return rows?.[0]?.anonymous_user_id || null;
}

async function persistConversationTurn(env, job, sessionId, responseText, candidates) {
  const owner = await guestOwner(env, job.discord_user_id);
  if (!owner || !sessionId) return;
  const now = new Date().toISOString();
  const rows = [
    {
      user_id: owner,
      conversation_id: sessionId,
      role: 'user',
      content: String(job.question || ''),
      metadata: { screen: 'discord', route: 'public_spec_candidates_v1', defaults: { horizon: '2-6 weeks', risk: 'balanced', formats: 'all', list_size: 10 } },
      created_at: now,
    },
    {
      user_id: owner,
      conversation_id: sessionId,
      role: 'assistant',
      content: responseText,
      metadata: { route: 'public_spec_candidates_v1', candidate_count: candidates.length, candidates: candidates.slice(0, 10).map((c) => ({ rank: c.rank, card_name: c.card_name, set_code: c.set_code, printing: c.printing, market_price: c.market_price, spec_score: c.spec_score })) },
      created_at: now,
    },
  ];
  await serviceRest(env, 'ask_collectish_messages', { method: 'POST', prefer: 'return=minimal', body: rows }).catch(() => null);
  await serviceRest(env, `ask_collectish_conversations?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(owner)}`, {
    method: 'PATCH',
    body: { updated_at: now },
  }).catch(() => null);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function reasonBits(row) {
  const bits = [];
  if (row.signal_count > 0) bits.push(`${row.signal_count} Signals/${row.independent_sources} sources`);
  if (Number(row.competitive_decks_7d || 0) > Number(row.competitive_decks_prev_7d || 0)) bits.push(`${row.competitive_decks_7d} comp decks 7d vs ${row.competitive_decks_prev_7d}`);
  if (row.edhrec_rank) bits.push(`EDHREC #${Number(row.edhrec_rank).toLocaleString()}`);
  if (row.avg_daily_qty_sold != null) bits.push(`${Number(row.avg_daily_qty_sold).toFixed(1)}/day`);
  if (row.direct_available != null && Number(row.direct_available) <= 25) bits.push(`${row.direct_available} Direct avail`);
  return bits.slice(0, 3);
}

function candidateLine(row) {
  const reasons = reasonBits(row);
  return `**${row.rank}. ${row.card_name}** — ${row.set_code || 'SET'} ${row.printing || ''} · ${money(row.market_price)} · Spec ${row.spec_score}\n${reasons.length ? reasons.join(' · ') : `Scout ${row.scout_grade || '—'} ${row.scout_score ?? '—'}`}`;
}

function specPayload(candidates) {
  const top = candidates.slice(0, 10);
  const first = top.slice(0, 5).map(candidateLine).join('\n\n');
  const second = top.slice(5, 10).map(candidateLine).join('\n\n');
  const fields = [];
  if (first) fields.push({ name: '1–5', value: first.slice(0, 1020), inline: false });
  if (second) fields.push({ name: '6–10', value: second.slice(0, 1020), inline: false });
  fields.push({
    name: 'How Delvin ranked these',
    value: 'Public market evidence only: Scout opportunity quality, Signals/source corroboration, competitive adoption acceleration, EDHREC demand, TCGplayer marketplace velocity, and visible supply. No Seller History, inventory, orders, or private account data is used.',
    inline: false,
  });
  return {
    content: '',
    embeds: [{
      title: 'Top MTG spec candidates — 2–6 week view',
      description: 'Using defaults: all formats, balanced risk, no hard per-card budget. This is a ranked **candidate list**, not a guarantee of appreciation.',
      fields,
      footer: { text: 'Collectish public-market spec ranking v1 • refine naturally with a short follow-up /ask' },
    }],
    components: [],
  };
}

function conversationText(candidates) {
  const lines = candidates.slice(0, 10).map((c) => `${c.rank}. ${c.card_name} (${c.set_code} ${c.printing || ''}) — Market ${money(c.market_price)}, spec score ${c.spec_score}; ${reasonBits(c).join(', ') || `Scout ${c.scout_grade} ${c.scout_score}`}.`);
  return `Using the default 2–6 week, balanced-risk, all-format view, the current public-market spec candidates are:\n${lines.join('\n')}\nThis ranking uses public Collectish market evidence across Scout, Signals, competitive adoption, EDHREC, TCGplayer marketplace velocity, and supply.`;
}

async function handleSpec(env, job, message) {
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return true;
  }
  await editOriginalDiscord(job, { content: '🔎 Delvin is ranking current public-market spec candidates…', embeds: [], components: [] }).catch(() => null);
  const candidates = await serviceRest(env, 'rpc/ask_collectish_public_spec_candidates_v1', { method: 'POST', body: { p_limit: 10 } });
  if (!Array.isArray(candidates) || !candidates.length) throw new Error('Public spec candidate ranking returned no rows');
  const binding = await getBinding(env, job);
  const sessionId = await ensureGuestSession(env, job, binding);
  await saveBinding(env, job, sessionId);
  const text = conversationText(candidates);
  await persistConversationTurn(env, job, sessionId, text, candidates);
  await editOriginalDiscord(job, specPayload(candidates));
  await updateDelivery(env, job.interaction_id, {
    response_text: text.slice(0, 1900),
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
    const isPrivate = String(job.response_visibility || '').toLowerCase() === 'ephemeral';
    if (isPrivate || !isSpecRecommendation(job.question)) {
      fallback.push(message);
      continue;
    }
    try {
      await handleSpec(env, job, message);
    } catch (error) {
      console.error('discord ask v12 spec route failed', { interaction_id: job.interaction_id, error: String(error?.message || error) });
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
