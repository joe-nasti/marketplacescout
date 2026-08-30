import entry from './discord-ask-entry-v10.mjs';

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

function delegateToRichDiscordPath(question) {
  const q = String(question || '');
  return [
    /\b(?:price|market|sales?|sale)\s+history\b/i,
    /\b(?:graph|chart|plot|visuali[sz]e)\b.*\b(?:price|market|sales?)\b/i,
    /\b(?:price|market|sales?)\b.*\b(?:graph|chart|plot|visuali[sz]e)\b/i,
    /\bseeing\s+play\b|\bsee\s+play\b|\bwhat\s+(?:decks?|archetypes?)\s+(?:play|use|run)\b/i,
    /\bwhy\s+(?:is|did)\b.*\b(?:moving|move|spiking|spike|rising|rise|jump|jumped)\b/i,
    /\bwhat\s+(?:is|was)\s+driving\b|\bwhat\s+drove\b/i,
  ].some((pattern) => pattern.test(q));
}

function isSpecRecommendation(question) {
  const q = String(question || '');
  return /\b(?:top|best|good|which|what)\b.*\b(?:cards?|specs?)\b.*\b(?:spec|buy|pick|target|watch)\b/i.test(q)
    || /\b(?:spec|speculate)\s+(?:on|into)\b/i.test(q)
    || /\bcards?\s+to\s+spec\b/i.test(q);
}

function defaultedRecommendationQuestion(question) {
  if (!isSpecRecommendation(question)) return question;
  return `${question}\n\nFor this recommendation, answer immediately instead of asking preference questions. Unless I explicitly said otherwise, use these defaults: Magic: The Gathering; all relevant formats; short-term means roughly the next 2–6 weeks; balanced/moderate risk; no hard per-card budget; return a ranked shortlist of about 10 cards. State the defaults briefly, use the strongest available Collectish evidence, and give the recommendation now. Do not ask me to choose timeframe, format, budget, risk profile, or list size before answering.`;
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

async function callGuestAsk(env, job, sessionId, firstTurn) {
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
      ...(sessionId ? { session_id: sessionId } : {}),
      message: firstTurn ? defaultedRecommendationQuestion(job.question) : job.question,
      context: {
        screen: 'discord',
        access_mode: 'guest',
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
  if (!response.ok) throw new Error(data?.error || `Ask API ${response.status}`);
  return data;
}

function answerText(data) {
  const answer = String(data?.response || data?.answer || data?.analysis || '').trim();
  if (answer) return answer.slice(0, 1950);
  return 'I completed the Ask request, but it did not return a text answer.';
}

async function handleConversationalJob(env, job, message) {
  const binding = await getBinding(env, job);
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return;
  }

  try {
    await editOriginalDiscord(job, { content: '🔎 Delvin is digging through Collectish…', embeds: [], components: [] }).catch(() => null);
    const data = await callGuestAsk(env, job, binding?.ask_session_id || null, !binding);
    const sessionId = data?.session_id || data?.conversation_id || binding?.ask_session_id || null;
    await saveBinding(env, job, sessionId);
    const content = answerText(data);
    await updateDelivery(env, job.interaction_id, { response_text: content });
    await editOriginalDiscord(job, { content, embeds: [], components: [] });
    await updateDelivery(env, job.interaction_id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_text: null,
    });
    message.ack();
  } catch (error) {
    const text = `Delvin hit an Ask error: ${String(error?.message || error).slice(0, 500)}`;
    await editOriginalDiscord(job, { content: text, embeds: [], components: [] }).catch(() => null);
    await updateDelivery(env, job.interaction_id, {
      status: 'failed',
      error_text: String(error?.message || error).slice(0, 1000),
      completed_at: new Date().toISOString(),
    }).catch(() => null);
    message.ack();
  }
}

async function handleQueue(batch, env, ctx) {
  const delegated = [];
  for (const message of batch.messages) {
    const job = message.body || {};
    const isPrivate = String(job.response_visibility || '').toLowerCase() === 'ephemeral';
    if (isPrivate || delegateToRichDiscordPath(job.question)) {
      delegated.push(message);
      continue;
    }
    await handleConversationalJob(env, job, message);
  }
  if (delegated.length) return entry.queue({ messages: delegated }, env, ctx);
}

export default {
  fetch(request, env, ctx) {
    return entry.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return handleQueue(batch, env, ctx);
  },
};
