import entry from './discord-ask-entry-v7.mjs';

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

async function linkForDiscord(env, discordUserId) {
  if (!discordUserId) return null;
  const rows = await serviceRest(env, `discord_collectish_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=id&limit=1`).catch(() => []);
  return rows?.[0] || null;
}

function usesSharedRouter(question) {
  const q = String(question || '');
  return /\b(?:price|market|sales?|sale)\s+history\b|\b(?:graph|chart|plot|visuali[sz]e)\b|\bover\s+the\s+(?:last|past)\s+\d+\s*(?:days?|weeks?|months?|years?)\b|\bresearch\b|\bdig\s+deeper\b|\binvestigate\b|\bwhy\s+(?:is|did)\b.*\b(?:moving|move|spiking|spike|rising|rise|jump|jumped)\b|\bwhat\s+(?:is|was)\s+driving\b|\bwhat\s+drove\b|\bwhat\s+changed\b|\bwhat\s+happened\s+first\b|\b(?:market|event)\s+timeline\b/i.test(q);
}

async function resolveSharedContext(env, question) {
  const rows = await serviceRest(env, 'rpc/ask_resolve_card_context', {
    method: 'POST',
    body: { p_question: question },
  }).catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

async function callGuestAsk(env, job, resolved) {
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
      context: {
        screen: 'discord',
        access_mode: 'guest',
        product_id: resolved.product_id || null,
        sku_id: resolved.sku_id || null,
        entity: {
          card_name: resolved.card_name || null,
          product_id: resolved.product_id || null,
          sku_id: resolved.sku_id || null,
          scryfall_id: resolved.scryfall_id || null,
          set_code: resolved.set_code || null,
          collector_number: resolved.collector_number || null,
          printing: resolved.printing || null,
          condition: resolved.condition || null,
          language: resolved.language || null,
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
  if (!response.ok) throw new Error(data?.error || `Ask API ${response.status}`);
  return data;
}

function answerText(data, resolved) {
  const answer = String(data?.response || data?.answer || '').trim();
  if (answer) return answer.slice(0, 1900);
  return `I resolved **${resolved.card_name}** in Collectish, but the shared Ask router did not return a text answer for this request yet.`;
}

async function handleResolvedSharedJob(env, job, message) {
  const linked = await linkForDiscord(env, job.discord_user_id);
  if (linked) return false;
  const resolved = await resolveSharedContext(env, job.question);
  if (!resolved?.product_id && !resolved?.sku_id) return false;

  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) {
    message.ack();
    return true;
  }

  await editOriginalDiscord(job, { content: '🔎 Delvin is digging through Collectish…', embeds: [], components: [] }).catch(() => null);
  const data = await callGuestAsk(env, job, resolved);
  const content = answerText(data, resolved);
  await updateDelivery(env, job.interaction_id, { response_text: content });
  await editOriginalDiscord(job, { content, embeds: [], components: [] });
  await updateDelivery(env, job.interaction_id, { status: 'completed', completed_at: new Date().toISOString(), error_text: null });
  message.ack();
  return true;
}

async function handleQueue(batch, env, ctx) {
  const fallback = [];
  for (const message of batch.messages) {
    const job = message.body || {};
    if (!usesSharedRouter(job.question)) {
      fallback.push(message);
      continue;
    }
    try {
      const handled = await handleResolvedSharedJob(env, job, message);
      if (!handled) fallback.push(message);
    } catch (error) {
      console.error('discord ask v8 shared resolver failed', {
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
