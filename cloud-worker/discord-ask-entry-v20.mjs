import entry from './discord-ask-entry-v19.mjs';

const DISCORD_API = 'https://discord.com/api/v10';
const QUICKCHART = 'https://quickchart.io/chart';
const CHART_FILE = 'collectish-cohort-movers.png';
const ACCENT = 0x7c5cff;

function supabaseBase(env) { return String(env.SUPABASE_URL || '').replace(/\/$/, ''); }
function serviceHeaders(env) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }; }
async function serviceRest(env, path, init = {}) {
  const response = await fetch(`${supabaseBase(env)}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: { ...serviceHeaders(env), ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text(); let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `Supabase REST ${response.status}`);
  return data;
}
async function editOriginalDiscord(job, payload) {
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!response.ok) throw new Error(`Discord webhook edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
}
async function editOriginalDiscordWithImage(job, payload, imageBlob) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ allowed_mentions: { parse: [] }, ...payload, attachments: [{ id: 0, filename: CHART_FILE }] }));
  form.append('files[0]', imageBlob, CHART_FILE);
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, { method: 'PATCH', body: form });
  if (!response.ok) throw new Error(`Discord multipart edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
}
async function claimDelivery(env, job) {
  const rows = await serviceRest(env, 'rpc/claim_discord_ask_delivery', { method: 'POST', body: { p_interaction_id: job.interaction_id, p_discord_user_id: job.discord_user_id } });
  return Array.isArray(rows) ? rows[0] : rows;
}
async function updateDelivery(env, interactionId, patch) {
  return serviceRest(env, `discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(interactionId)}`, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() } });
}

function cohortPhrase(question) {
  const q = String(question || '').trim();
  const patterns = [
    /^why\s+are\s+(?:all\s+)?(.+?)(?:\s+cards?)?\s+(?:moving|spiking|rising|jumping|up)\??$/i,
    /^why\s+did\s+(?:all\s+)?(.+?)(?:\s+cards?)?\s+(?:move|spike|rise|jump)\??$/i,
    /^what(?:'s|\s+is)\s+driving\s+(?:all\s+)?(.+?)(?:\s+cards?)?\??$/i,
    /^what\s+drove\s+(?:all\s+)?(.+?)(?:\s+cards?)?\??$/i,
  ];
  for (const p of patterns) {
    const m = q.match(p);
    if (m?.[1]) return m[1].trim().replace(/[?.!,]+$/g, '');
  }
  return null;
}
function subtypeCandidates(raw) {
  const s = String(raw || '').trim().replace(/\s+tribal$/i, '');
  const lower = s.toLowerCase();
  const irregular = { elves: 'Elf', wolves: 'Wolf', dwarves: 'Dwarf', mice: 'Mouse', geese: 'Goose', oxen: 'Ox', children: 'Child' };
  const out = [];
  if (irregular[lower]) out.push(irregular[lower]);
  if (/ies$/i.test(s)) out.push(s.replace(/ies$/i, 'y'));
  if (/s$/i.test(s)) out.push(s.replace(/s$/i, ''));
  out.push(s);
  return [...new Set(out.map(x => x ? x[0].toUpperCase() + x.slice(1) : x).filter(Boolean))];
}
async function scryfallSubtype(raw) {
  for (const subtype of subtypeCandidates(raw)) {
    let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`t:${subtype} game:paper`)}`;
    const cards = [];
    for (let page = 0; page < 4 && url; page++) {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Collectish/1.0 cohort resolver' } });
      if (!response.ok) { url = null; break; }
      const data = await response.json();
      for (const card of data?.data || []) cards.push({ name: card?.name, oracle_id: card?.oracle_id, id: card?.id, type_line: card?.type_line });
      url = data?.has_more ? data?.next_page : null;
    }
    if (cards.length) return { subtype, cards };
  }
  return null;
}
function norm(v) { return String(v || '').toLowerCase().replace(/\s*\/\/\s*.*/, '').replace(/\([^)]*\)\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
async function recentMtgSignals(env) {
  const cutoff = new Date(Date.now() - 10 * 86400000).toISOString();
  return serviceRest(env, `market_intel_items?observed_at=gte.${encodeURIComponent(cutoff)}&source_name=eq.MTGStocks&select=intel_id,source_name,source_url,title,summary,published_at,observed_at&order=observed_at.desc&limit=800`).catch(() => []);
}
function signalCardName(signal) {
  const title = String(signal?.title || '');
  const pieces = title.split('·').map(x => x.trim()).filter(Boolean);
  return pieces.length ? pieces.at(-1) : null;
}
function parseMove(signal) {
  const text = `${signal?.title || ''} ${signal?.summary || ''}`;
  const m = text.match(/\b(average|market)\b.*?\b(foil|regular|nonfoil|non-foil)?\b.*?from \$([\d.]+) to \$([\d.]+) \(([+-]?[\d.]+)%\)/i);
  if (!m) return null;
  return { metric: m[1].toLowerCase(), finish: (m[2] || '').toLowerCase(), from: Number(m[3]), to: Number(m[4]), change: Number(m[5]), observed_at: signal.observed_at, url: signal.source_url };
}
function cohortMovers(cards, signals) {
  const names = new Map();
  for (const c of cards || []) names.set(norm(c.name), c.name);
  const matched = [];
  for (const s of signals || []) {
    const raw = signalCardName(s); const n = norm(raw); if (!n) continue;
    let canonical = names.get(n);
    if (!canonical) {
      for (const [key, value] of names) {
        if (n === key || n.startsWith(`${key} `) || key.startsWith(`${n} `)) { canonical = value; break; }
      }
    }
    if (!canonical) continue;
    const move = parseMove(s); if (!move) continue;
    matched.push({ card_name: canonical, signal_name: raw, ...move, title: s.title, summary: s.summary, source_url: s.source_url });
  }
  const best = new Map();
  for (const row of matched) {
    const key = `${norm(row.card_name)}|${row.finish || 'regular'}`;
    const old = best.get(key);
    const rank = (row.metric === 'market' ? 10000 : 0) + Math.abs(row.change || 0);
    const oldRank = old ? (old.metric === 'market' ? 10000 : 0) + Math.abs(old.change || 0) : -1;
    if (!old || rank > oldRank) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => {
    if (a.metric !== b.metric) return a.metric === 'market' ? -1 : 1;
    return Math.abs(b.change) - Math.abs(a.change);
  });
}
async function familyResearch(env, job, subtype, movers) {
  const products = [...new Set(movers.slice(0, 12).map(m => m.card_name))];
  const response = await fetch(`${supabaseBase(env)}/functions/v1/ask-collectish-family-research`, {
    method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({
      discord_user_id: String(job.discord_user_id || ''),
      question: `Why are Magic: The Gathering ${subtype} cards moving together? Identify the strongest shared catalyst for the ${subtype} creature-type cohort. Search MTG-specific and broader relevant news. Do not ask me to choose a card or timeframe.`,
      card: { name: `${subtype} tribal`, product_name: `${subtype} tribal`, family_alias: `${subtype} tribal`, family_products: products },
      internal_evidence: { cohort_type: 'creature_subtype', creature_subtype: subtype, moving_cards: movers.slice(0, 20) },
    }),
  });
  const raw = await response.text(); let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) throw new Error(data?.error || `Cohort research ${response.status}`);
  return data;
}
function confidence(v) { const s = String(v || 'unknown').toLowerCase(); return s === 'high' ? 'HIGH' : s === 'medium' ? 'MEDIUM' : s === 'low' ? 'LOW' : 'UNKNOWN'; }
function clip(v, max = 650) { const s = String(v || '').replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1').trim(); return s.length <= max ? s : `${s.slice(0, max - 1)}…`; }
function sourceLabel(s) { try { const h = new URL(s.url).hostname.replace(/^www\./, ''); if (/magic\.wizards|wizards/.test(h)) return 'Wizards'; if (/edhrec/.test(h)) return 'EDHREC'; if (/tcgplayer/.test(h)) return 'TCGplayer'; if (/mtgstocks/.test(h)) return 'MTGStocks'; if (/reddit/.test(h)) return 'Reddit'; return (s.title || h).slice(0, 70); } catch { return (s.title || 'Source').slice(0, 70); } }
function components(research, movers) {
  const buttons = []; const seen = new Set();
  for (const s of research?.sources || []) { if (!s?.url || seen.has(s.url)) continue; seen.add(s.url); buttons.push({ type: 2, style: 5, label: sourceLabel(s), url: s.url }); if (buttons.length >= 3) break; }
  const mtg = movers.find(m => m.source_url)?.source_url; if (mtg && !seen.has(mtg)) buttons.push({ type: 2, style: 5, label: 'MTGStocks', url: mtg });
  return buttons.length ? [{ type: 1, components: buttons.slice(0, 5) }] : [];
}
async function renderMoverChart(subtype, movers) {
  const top = movers.slice(0, 8);
  if (!top.length) return null;
  const labels = top.map(m => m.card_name.length > 28 ? `${m.card_name.slice(0, 27)}…` : m.card_name);
  const data = top.map(m => Number(m.change || 0));
  const chart = {
    type: 'horizontalBar',
    data: { labels, datasets: [{ label: '% move', data, backgroundColor: '#7c5cff', borderWidth: 0 }] },
    options: {
      responsive: false,
      legend: { display: false },
      title: { display: true, text: `Top ${subtype} movers · recent MTGStocks signals`, fontSize: 18 },
      scales: {
        xAxes: [{ ticks: { beginAtZero: true, callback: v => `${v}%` }, gridLines: { color: 'rgba(120,120,120,.12)' } }],
        yAxes: [{ gridLines: { display: false }, ticks: { fontSize: 12 } }],
      },
      plugins: { datalabels: { display: false } },
    },
  };
  try {
    const response = await fetch(QUICKCHART, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'image/png' }, body: JSON.stringify({ width: 920, height: Math.max(420, 95 + top.length * 54), format: 'png', backgroundColor: '#202124', chart }) });
    if (!response.ok) return null;
    const blob = await response.blob(); return blob.size ? blob : null;
  } catch { return null; }
}
function payload(subtype, cohortSize, movers, research, withImage) {
  const a = research?.analysis || {};
  const marketMovers = movers.filter(m => m.metric === 'market');
  const best = (marketMovers[0] || movers[0]);
  const breadth = new Set(movers.map(m => norm(m.card_name))).size;
  const summary = a.catalyst_summary || research?.answer || `I found ${breadth} ${subtype} cards with recent movement signals.`;
  const topLine = best ? `${best.card_name} ${best.metric === 'market' ? 'Market' : 'Average'} ${best.from.toFixed(2)} → ${best.to.toFixed(2)} (${best.change >= 0 ? '+' : ''}${best.change.toFixed(1)}%)` : 'No quantified mover available.';
  const embed = {
    color: ACCENT,
    title: `↗ ${subtype} cohort · why it’s moving`,
    description: `**${a.catalyst_title || `Shared ${subtype} demand catalyst`}**\n${clip(summary, 560)}`,
    fields: [
      { name: 'CONFIDENCE', value: `${confidence(a.causal_confidence)} catalyst · ${confidence(a.event_confidence)} event`, inline: true },
      { name: 'BREADTH', value: `${breadth} movers detected · ${cohortSize} ${subtype} cards in Scryfall cohort`, inline: true },
      { name: 'LEADER', value: topLine, inline: false },
    ],
    footer: { text: 'Cohort defined by Scryfall type line · movement from Collectish/MTGStocks public signals' },
  };
  if (withImage) embed.image = { url: `attachment://${CHART_FILE}` };
  return { content: '', embeds: [embed], components: components(research, movers) };
}

async function handleCohort(env, job, message) {
  const raw = cohortPhrase(job.question); if (!raw) return false;
  const claim = await claimDelivery(env, job); if (!claim?.claimed) { message.ack(); return true; }
  try {
    await editOriginalDiscord(job, { content: `🔎 Delvin is mapping the ${raw} cohort and its movers…`, embeds: [], components: [] }).catch(() => null);
    const cohort = await scryfallSubtype(raw);
    if (!cohort?.cards?.length) throw new Error(`I couldn't resolve “${raw}” as an MTG creature subtype cohort.`);
    const signals = await recentMtgSignals(env);
    const movers = cohortMovers(cohort.cards, signals);
    if (!movers.length) throw new Error(`I resolved ${cohort.subtype} as an MTG subtype, but found no recent MTGStocks movement signals for that cohort.`);
    const research = await familyResearch(env, job, cohort.subtype, movers);
    const image = await renderMoverChart(cohort.subtype, movers);
    const out = payload(cohort.subtype, cohort.cards.length, movers, research, Boolean(image));
    if (image) await editOriginalDiscordWithImage(job, out, image); else await editOriginalDiscord(job, out);
    await updateDelivery(env, job.interaction_id, { response_text: String(research?.answer || `${cohort.subtype}: ${movers.length} movers detected`).slice(0, 1900), status: 'completed', completed_at: new Date().toISOString(), error_text: null });
    message.ack(); return true;
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 500);
    await editOriginalDiscord(job, { content: `Delvin couldn't finish the cohort investigation: ${detail}`, embeds: [], components: [] }).catch(() => null);
    await updateDelivery(env, job.interaction_id, { status: 'failed', error_text: detail, completed_at: new Date().toISOString() }).catch(() => null);
    message.ack(); return true;
  }
}

export default {
  fetch(request, env, ctx) { return entry.fetch(request, env, ctx); },
  async queue(batch, env, ctx) {
    const fallback = [];
    for (const message of batch.messages) {
      const job = message.body || {};
      const cohort = cohortPhrase(job.question);
      const isPrivate = String(job.response_visibility || '').toLowerCase() === 'ephemeral';
      if (!cohort || isPrivate) { fallback.push(message); continue; }
      await handleCohort(env, job, message);
    }
    if (fallback.length) return entry.queue({ messages: fallback }, env, ctx);
  },
};
