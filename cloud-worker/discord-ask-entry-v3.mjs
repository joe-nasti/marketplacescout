import entry from './discord-ask-entry-v2.mjs';

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
    headers: {
      ...serviceHeaders(env),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `Supabase REST ${response.status}`);
  return data;
}

async function linkForDiscord(env, discordUserId) {
  const rows = await serviceRest(env, `discord_collectish_links?discord_user_id=eq.${encodeURIComponent(discordUserId)}&select=id&limit=1`);
  return rows?.[0] || null;
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

async function editOriginalDiscord(job, payload) {
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!response.ok) throw new Error(`Discord webhook edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
}

function extractCardName(question) {
  const q = clean(question, 500);
  const patterns = [
    /^where\s+is\s+(.+?)\s+seeing\s+play\??$/i,
    /^where\s+does\s+(.+?)\s+see\s+play\??$/i,
    /^what\s+(?:decks?|archetypes?)\s+(?:play|use|run)\s+(.+?)\??$/i,
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

function isPlayIntent(question) {
  return /\bseeing\s+play\b|\bsee\s+play\b|\bwhat\s+(?:decks?|archetypes?)\s+(?:play|use|run)\b/i.test(question || '');
}

function isMoveIntent(question) {
  return /\b(?:moving|spiking|rising|price spike|price move)\b|\bwhy\s+did\b.*\b(?:move|spike|jump|rise)\b/i.test(question || '');
}

async function resolveCard(env, question) {
  const name = extractCardName(question);
  if (!name) return null;
  const rows = await serviceRest(
    env,
    `scout_card_catalog?card_name=ilike.${encodeURIComponent(name)}&select=sku_id,product_id,scryfall_id,card_name,set_code,collector_number,printing,condition,language&limit=40`,
  ).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  const exact = rows.filter((row) => String(row.card_name || '').toLowerCase() === name.toLowerCase());
  const pool = exact.length ? exact : rows;
  const nmEnglish = pool.filter((row) => String(row.condition || '').toUpperCase() === 'NEAR MINT' && String(row.language || '').toUpperCase() === 'ENGLISH');
  return { name: pool[0].card_name, printings: (nmEnglish.length ? nmEnglish : pool).slice(0, 20) };
}

function compactTrend(row) {
  const now = Number(row.decks_7d || 0);
  const prev = Number(row.decks_prev_7d || 0);
  if (!prev) return `${now} decks in last 7d`;
  const pct = ((now - prev) / prev) * 100;
  const arrow = pct > 10 ? '↗' : pct < -10 ? '↘' : '→';
  return `${arrow} ${now} last 7d vs ${prev} prior (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`;
}

async function competitivePayload(env, resolved) {
  const cardName = resolved.name;
  const rollups = await serviceRest(
    env,
    `competitive_card_rollups?card_name=ilike.${encodeURIComponent(cardName)}&select=card_name,format,event_count_30d,deck_count_30d,top8_decks_30d,wins_30d,copies_30d,decks_7d,decks_prev_7d,last_seen&order=deck_count_30d.desc.nullslast`,
  ).catch(() => []);

  if (!Array.isArray(rollups) || !rollups.length) {
    return { content: `**${cardName}** resolved as an MTG card, but Collectish has no recent competitive deck appearances for it yet.`, embeds: [], components: [] };
  }

  const cards = await serviceRest(
    env,
    `competitive_deck_cards?card_name=ilike.${encodeURIComponent(cardName)}&select=deck_id,section,quantity&order=created_at.desc&limit=100`,
  ).catch(() => []);
  const deckIds = [...new Set((cards || []).map((row) => row.deck_id).filter(Boolean))].slice(0, 70);
  let decks = [];
  let events = [];
  if (deckIds.length) {
    decks = await serviceRest(
      env,
      `competitive_decks?deck_id=in.(${deckIds.join(',')})&select=deck_id,event_id,player_name,placement,archetype,record,source_url&limit=70`,
    ).catch(() => []);
    const eventIds = [...new Set((decks || []).map((row) => row.event_id).filter(Boolean))].slice(0, 50);
    if (eventIds.length) {
      events = await serviceRest(
        env,
        `competitive_events?event_id=in.(${eventIds.join(',')})&select=event_id,event_name,format,event_type,event_date,source_url&order=event_date.desc&limit=50`,
      ).catch(() => []);
    }
  }

  const eventById = new Map((events || []).map((event) => [event.event_id, event]));
  const recent = (decks || [])
    .map((deck) => ({ ...deck, event: eventById.get(deck.event_id) }))
    .filter((deck) => deck.event)
    .sort((a, b) => String(b.event.event_date).localeCompare(String(a.event.event_date)) || Number(a.placement || 999) - Number(b.placement || 999));

  const fields = rollups.slice(0, 6).map((row) => ({
    name: row.format || 'Unknown format',
    value: [
      `**${Number(row.deck_count_30d || 0)} decks** · ${Number(row.event_count_30d || 0)} events · ${Number(row.copies_30d || 0)} copies`,
      `${Number(row.top8_decks_30d || 0)} Top 8s · ${Number(row.wins_30d || 0)} wins`,
      compactTrend(row),
      row.last_seen ? `Last seen ${row.last_seen}` : null,
    ].filter(Boolean).join('\n'),
    inline: true,
  }));

  const exampleLines = recent.slice(0, 6).map((deck) => {
    const event = deck.event;
    const url = deck.source_url || event.source_url;
    const place = deck.placement ? `#${deck.placement}` : 'listed';
    const archetype = deck.archetype ? ` · ${deck.archetype}` : '';
    const label = `${event.event_date} ${event.format} — ${event.event_name}`;
    const linked = url ? `[${label}](${url})` : label;
    return `${linked}\n${place} ${deck.player_name || 'player'}${archetype}`;
  });
  if (exampleLines.length) {
    fields.push({ name: 'Recent decklists', value: exampleLines.join('\n'), inline: false });
  }

  const buttons = [];
  const seen = new Set();
  for (const deck of recent) {
    const url = deck.source_url || deck.event?.source_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    buttons.push({ type: 2, style: 5, label: `Open ${deck.event?.format || 'decklist'}`.slice(0, 80), url });
    if (buttons.length >= 3) break;
  }

  return {
    content: '',
    embeds: [{
      title: `${cardName} — competitive play`,
      description: 'Recent constructed usage from Collectish-imported tournament decklists.',
      fields,
      footer: { text: 'MTGO/deck-source links are clickable. Archetype labels may be missing on some imported lists.' },
    }],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
  };
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—';
}

function dollars(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

async function marketMovePayload(env, resolved) {
  const cardName = resolved.name;
  const skuIds = [...new Set(resolved.printings.map((row) => String(row.sku_id || '')).filter(Boolean))];
  const productIds = [...new Set(resolved.printings.map((row) => String(row.product_id || '')).filter(Boolean))];
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();

  let current = [];
  let history = [];
  let signalSales = [];
  if (skuIds.length) {
    const inSkus = skuIds.join(',');
    [current, history, signalSales] = await Promise.all([
      serviceRest(env, `tcgplayer_official_sku_price_current?sku_id=in.(${inSkus})&select=sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at`).catch(() => []),
      serviceRest(env, `tcgplayer_official_sku_price_history?sku_id=in.(${inSkus})&observed_at=gte.${encodeURIComponent(cutoff)}&select=sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at&order=observed_at.asc&limit=2000`).catch(() => []),
      serviceRest(env, `marketplace_signal_sku_sales_response?card_name=ilike.${encodeURIComponent(cardName)}&select=set_code,product_id,sku_id,printing,signal_first_at,signal_last_at,average_daily_quantity_sold,average_daily_transaction_count,transaction_velocity_lift_30d_pct,quantity_velocity_lift_matched_pct,evidence_level,evidence_status,evidence_confidence,signal_market_price,latest_market_price,market_price_change_pct,latest_bucket_date&order=signal_last_at.desc.nullslast&limit=20`).catch(() => []),
    ]);
  }

  const mentions = await serviceRest(
    env,
    `market_intel_card_mentions?card_name=ilike.${encodeURIComponent(cardName)}&select=intel_id,card_name,product_id,set_code,confidence,resolution,created_at&order=created_at.desc&limit=20`,
  ).catch(() => []);
  const intelIds = [...new Set((mentions || []).map((row) => row.intel_id).filter(Boolean))].slice(0, 20);
  let intel = [];
  if (intelIds.length) {
    intel = await serviceRest(
      env,
      `market_intel_items?intel_id=in.(${intelIds.join(',')})&select=intel_id,source_type,source_name,source_url,title,summary,claim_type,direction,signal_stage,confidence,published_at,observed_at&order=published_at.desc.nullslast&limit=20`,
    ).catch(() => []);
  }

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
    return { row, printing: printingBySku.get(key), start, latest, change };
  }).sort((a, b) => Math.abs(Number(b.change || 0)) - Math.abs(Number(a.change || 0)));

  const priceLines = priceRows.slice(0, 5).map((item) => {
    const p = item.printing || {};
    const label = `${p.set_code || 'SET'} ${p.printing || ''}`.trim();
    return `**${label}** · Market ${dollars(item.latest)}${Number.isFinite(item.change) ? ` (${pct(item.change)} vs ~30d first observation)` : ''} · Low ${dollars(item.row.lowest_listing_price ?? item.row.low_price)}${item.row.direct_low_price != null ? ` · Direct ${dollars(item.row.direct_low_price)}` : ''}`;
  });

  const salesLines = (signalSales || []).slice(0, 4).map((row) => {
    const bits = [
      `${row.set_code || 'SET'} ${row.printing || ''}`.trim(),
      row.average_daily_quantity_sold != null ? `${Number(row.average_daily_quantity_sold).toFixed(1)} cards/day` : null,
      row.transaction_velocity_lift_30d_pct != null ? `transaction velocity ${pct(row.transaction_velocity_lift_30d_pct)}` : null,
      row.market_price_change_pct != null ? `signal→latest price ${pct(row.market_price_change_pct)}` : null,
      row.evidence_status ? String(row.evidence_status).replace(/_/g, ' ') : null,
    ].filter(Boolean);
    return `• ${bits.join(' · ')}`;
  });

  const intelById = new Map((intel || []).map((row) => [row.intel_id, row]));
  const catalystLines = [];
  const sourceButtons = [];
  const seenUrls = new Set();
  for (const mention of mentions || []) {
    const item = intelById.get(mention.intel_id);
    if (!item) continue;
    const title = clean(item.title || item.summary || item.source_name || 'Signal', 110);
    const source = clean(item.source_name || item.source_type || 'Signal', 50);
    const date = String(item.published_at || item.observed_at || mention.created_at || '').slice(0, 10);
    catalystLines.push(item.source_url ? `• [${title}](${item.source_url}) — ${source}${date ? ` · ${date}` : ''}` : `• ${title} — ${source}${date ? ` · ${date}` : ''}`);
    if (item.source_url && !seenUrls.has(item.source_url) && sourceButtons.length < 3) {
      seenUrls.add(item.source_url);
      sourceButtons.push({ type: 2, style: 5, label: `Open ${source}`.slice(0, 80), url: item.source_url });
    }
    if (catalystLines.length >= 5) break;
  }

  const moved = priceRows.filter((row) => Number.isFinite(row.change) && Math.abs(row.change) >= 5);
  let read = 'Collectish does not yet have enough 30-day price history to confidently characterize the move.';
  if (moved.length >= 2) read = `The move appears **broad across ${moved.length} printings**, which is more consistent with card-level demand than one isolated listing.`;
  else if (moved.length === 1) read = `The measurable move is currently **printing-specific** (${moved[0].printing?.set_code || 'one printing'}), so I would not assume every printing is moving equally.`;
  if (catalystLines.length && salesLines.length) read += ' Collectish also has both catalyst/signal evidence and sales-response data to compare against the price action.';
  else if (catalystLines.length) read += ' Collectish has recent signal/catalyst evidence, but sales confirmation is limited.';
  else if (salesLines.length) read += ' Sales-response data exists, but no recent named content catalyst is currently attached to this card.';

  const fields = [
    { name: 'Price action', value: priceLines.length ? priceLines.join('\n') : 'No current TCGplayer price rows were available for the resolved printings.', inline: false },
    { name: 'Sales confirmation', value: salesLines.length ? salesLines.join('\n') : 'No signal-linked sales response is currently available.', inline: false },
    { name: 'Likely catalysts / signals', value: catalystLines.length ? catalystLines.join('\n') : 'No recent named Collectish signal is currently attached to this card.', inline: false },
    { name: 'Read', value: read, inline: false },
  ];

  return {
    content: '',
    embeds: [{
      title: `${cardName} — why is it moving?`,
      description: `Resolved automatically as a Magic: The Gathering card across ${resolved.printings.length} known NM English printing${resolved.printings.length === 1 ? '' : 's'}.`,
      fields,
      footer: { text: 'Evidence comes from Collectish price history, sales-response tables, and Signals provenance.' },
    }],
    components: sourceButtons.length ? [{ type: 1, components: sourceButtons }] : [],
  };
}

async function handleSpecialGuest(env, job, resolved) {
  const claim = await claimDelivery(env, job);
  if (!claim?.claimed) return true;

  await editOriginalDiscord(job, { content: '🔎 Delvin is digging through Collectish…', embeds: [], components: [] }).catch(() => null);
  const payload = isPlayIntent(job.question)
    ? await competitivePayload(env, resolved)
    : await marketMovePayload(env, resolved);

  const stored = clean(
    payload?.embeds?.[0]?.title
      ? `${payload.embeds[0].title}: ${payload.embeds[0].description || ''}`
      : payload?.content || 'Discord rich response',
    1950,
  );
  await updateDelivery(env, job.interaction_id, { response_text: stored });
  await editOriginalDiscord(job, payload);
  await updateDelivery(env, job.interaction_id, { status: 'completed', completed_at: new Date().toISOString(), error_text: null });
  return true;
}

async function handleQueue(batch, env, ctx) {
  for (const message of batch.messages) {
    const job = message.body || {};
    try {
      const linked = job.discord_user_id ? await linkForDiscord(env, job.discord_user_id) : null;
      if (linked) {
        await entry.queue({ messages: [message] }, env, ctx);
        continue;
      }

      const special = isPlayIntent(job.question) || isMoveIntent(job.question);
      if (!special) {
        await entry.queue({ messages: [message] }, env, ctx);
        continue;
      }

      const resolved = await resolveCard(env, job.question);
      if (!resolved) {
        await entry.queue({ messages: [message] }, env, ctx);
        continue;
      }

      await handleSpecialGuest(env, job, resolved);
      message.ack();
    } catch (error) {
      console.error('discord ask rich response failed', {
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
