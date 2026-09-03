// App-side deterministic market-radar guard.
// Global market questions must not be hijacked by whichever Scout card happens to be selected.
(() => {
  if (window.__CollectishDelvinRadarRouteInstalled) return;
  window.__CollectishDelvinRadarRouteInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const isAskEndpoint = input => {
    const u = typeof input === 'string' ? input : input?.url || '';
    return /\/functions\/v1\/ask-collectish(?:\?|$)/.test(String(u));
  };
  const globalRadarIntent = q => {
    const s = String(q || '').toLowerCase().replace(/[’]/g, "'").trim();
    // Keep explicit source/family asks out of this generic market-wide route.
    if (/\b(?:edh|commander demand|creator|mtgstocks|tcgplayer climbing|syp|direct pressure|cross[- ]?market)\b/.test(s)) return false;
    return /\bwhat should i look at(?: right now)?\b|\bmarket radar\b|\bbest opportunities right now\b|\bwhat is moving right now\b|\btop movers(?: today)?\b|\bbiggest movers today\b|\bwhat moved today\b|\bwhat(?:'s| is) moving today\b/.test(s);
  };
  const short = (v, n = 54) => { const s = String(v ?? '').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—';
  const sourceName = v => ({
    direct_pressure: 'Direct pressure', sales_acceleration: 'Sales acceleration', cross_market: 'Cross-market',
    tcgplayer_climbing: 'TCGplayer climbing', mtgstocks: 'MTGStocks', syp: 'SYP',
    edh_demand: 'EDH demand', creator_catalyst: 'Creator catalyst'
  })[v] || v;
  const evidence = row => {
    const out = [];
    for (const e of Array.isArray(row?.evidence) ? row.evidence : []) {
      const d = e?.data || {};
      if (e.source === 'direct_pressure') out.push(`Direct ${d.old_direct_available ?? '?'}→${d.direct_available ?? '?'} · ${num(d.avg_daily_qty_sold, 1)}/day`);
      else if (e.source === 'sales_acceleration') out.push(`sales ${num(d.recent_daily_qty, 1)}/day vs ${num(d.baseline_daily_qty, 1)}/day`);
      else if (e.source === 'edh_demand') out.push(`EDH ${d.article_count || 1} article${Number(d.article_count || 1) === 1 ? '' : 's'}`);
      else if (e.source === 'creator_catalyst') out.push(`creator ${d.source_count || 1} source${Number(d.source_count || 1) === 1 ? '' : 's'}`);
      else if (e.source === 'syp') out.push(`SYP ${String(d.event_type || 'change').toLowerCase().replaceAll('_', ' ')}`);
      else if (e.source === 'cross_market') out.push(`${d.best_exit || 'exit'} spread`);
      if (out.length >= 2) break;
    }
    return out.join(' · ');
  };
  const renderRadar = cache => {
    const rows = Array.isArray(cache?.payload?.rows) ? cache.payload.rows : [];
    if (!rows.length) return 'Delvin market radar has no warm market signals strong enough to surface right now.';
    const lines = ['## Delvin market radar'];
    for (const tier of ['Confirmed', 'Converging', 'Watch', 'Single-source']) {
      const group = rows.filter(r => (r.evidence_tier || 'Single-source') === tier).slice(0, tier === 'Single-source' ? 5 : 6);
      if (!group.length) continue;
      lines.push(`\n### ${tier}`);
      group.forEach((r, i) => {
        const src = Array.isArray(r.sources) ? r.sources.map(sourceName).join(' + ') : '';
        lines.push(`${i + 1}. **${short(r.card_name)}** · ${r.set_code || 'SET?'} · radar **${num(r.radar_score)}** · ${r.source_count || 1} signal${Number(r.source_count || 1) === 1 ? '' : 's'}`);
        const ev = evidence(r);
        if (src || ev) lines.push(`   ↳ ${[src, ev].filter(Boolean).join(' · ')}`);
      });
    }
    lines.push('\n*Single-source = investigate, not confirmation. Market-wide queries ignore the currently selected Scout card.*');
    return lines.join('\n');
  };

  window.fetch = async function(input, init = {}) {
    if (!isAskEndpoint(input) || String(init?.method || 'GET').toUpperCase() !== 'POST') return nativeFetch(input, init);
    let body = null;
    try { body = JSON.parse(String(init?.body || '{}')); } catch { return nativeFetch(input, init); }
    if (body?.action !== 'chat' || !globalRadarIntent(body?.message)) return nativeFetch(input, init);

    try {
      const cache = await window.rest('rpc/get_delvin_query_cache_v1', { method: 'POST', body: { p_query_key: 'market_radar' } });
      if (!cache?.payload || !Array.isArray(cache.payload.rows) || !cache.payload.rows.length) return nativeFetch(input, init);
      const response = renderRadar(cache);
      return new Response(JSON.stringify({
        ok: true,
        conversation_id: body.conversation_id || null,
        response,
        model: 'Delvin deterministic',
        usage: { total_tokens: 0 },
        tools: [{ name: 'get_delvin_query_cache_v1', ok: true, classification: 'READ' }],
        ui_actions: [],
        context_screen: 'market',
        deterministic_route: 'market_radar',
        generated_at: cache.generated_at || null
      }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch (e) {
      console.warn('Delvin app market-radar route failed; using normal Ask path', e);
      return nativeFetch(input, init);
    }
  };
})();
