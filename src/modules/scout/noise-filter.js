// Collectish Scout feed noise filter v2 — hide sub-$2 Market rows unless demand momentum is genuinely positive.
(() => {
  const LOW_MARKET = 2;
  // Versioned key intentionally resets the default to ON after the stricter filter ships.
  const STORAGE_KEY = 'collectishScoutHideLowMarketV2';
  let meta = new Map();
  let loading = false;
  let queued = false;

  function enabled(){
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v == null ? true : v !== 'false';
    } catch { return true; }
  }

  function setEnabled(v){
    try { localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false'); } catch {}
  }

  function n(v){ const x=Number(v); return Number.isFinite(x)?x:0; }

  function isSurging(r){
    if (!r) return false;
    const edh = r.demand_sources?.edhrec || {};
    const adjustment = n(r.demand_adjustment);
    if (adjustment >= 5) return true;

    // Only measurable positive movement counts as a low-value exception.
    // demand_signal_score itself is deliberately ignored because high values can mean reprint risk.
    const deck = n(edh.deckChangePct);
    const commanderDeck = n(edh.commanderDeckChangePct);
    const rank = n(edh.rankChange);
    const commanderRank = n(edh.commanderRankChange);
    if (deck >= 0.25 || commanderDeck >= 0.25) return true;
    if ((rank >= 250 || commanderRank >= 250) && adjustment > 0) return true;

    const signal = String(r.demand_signal || '').toLowerCase();
    return adjustment > 0 && (signal.includes('surging') || signal.includes('breakout') || signal.includes('accelerating'));
  }

  async function loadMeta(){
    if (loading) return;
    loading = true;
    try {
      const rows = await rest('scout_opportunities_24h?select=sku_id,sku_market_price,demand_signal,demand_signal_score,demand_sources,demand_adjustment&order=opportunity_score.desc,observation_count.desc&limit=1000');
      meta = new Map((rows || []).map(r => [String(r.sku_id || ''), r]));
    } catch (e) {
      console.warn('Scout low-market filter metadata unavailable', e);
    } finally {
      loading = false;
      apply();
    }
  }

  function marketFromCard(card){
    const metric=[...card.querySelectorAll('.cx-scout-card-metrics span')].find(x=>/^Market\b/i.test(x.textContent||''));
    const m=(metric?.textContent||'').match(/\$([0-9,.]+)/);
    return m ? Number(m[1].replace(/,/g,'')) : NaN;
  }

  function ensureUi(){
    const page = document.getElementById('cxScout');
    const toolbar = page?.querySelector('.cx-scout-toolbar');
    if (!page || !toolbar) return null;
    let wrap = page.querySelector('.cx-scout-noise-filter');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'cx-scout-noise-filter';
      wrap.innerHTML = `<label><input type="checkbox" id="cxScoutHideLowMarket"> <span>Hide Market &lt; $${LOW_MARKET.toFixed(0)} unless demand is surging</span></label><small id="cxScoutNoiseCount"></small>`;
      toolbar.insertAdjacentElement('afterend', wrap);
      const input = wrap.querySelector('#cxScoutHideLowMarket');
      input.checked = enabled();
      input.addEventListener('change', () => { setEnabled(input.checked); apply(); });
    }
    const input = wrap.querySelector('#cxScoutHideLowMarket');
    if (input) input.checked = enabled();
    return wrap;
  }

  function apply(){
    queued = false;
    const page = document.getElementById('cxScout');
    const host = document.getElementById('cxParityCards');
    if (!page || !host) return;
    const wrap = ensureUi();
    const hide = enabled();
    let hidden = 0, exceptions = 0;

    for (const card of host.querySelectorAll('.cx-scout-card')) {
      const sku = String(card.dataset.sku || '');
      const r = meta.get(sku);
      const dbMarket = Number(r?.sku_market_price);
      const fallbackMarket = marketFromCard(card);
      const market = Number.isFinite(dbMarket) ? dbMarket : fallbackMarket;
      const low = Number.isFinite(market) && market >= 0 && market < LOW_MARKET;
      const surge = isSurging(r);
      const shouldHide = hide && low && !surge;
      card.classList.toggle('cx-scout-low-hidden', shouldHide);
      card.dataset.lowMarket = low ? 'true' : 'false';
      card.dataset.surging = surge ? 'true' : 'false';
      if (shouldHide) hidden++;
      else if (low && surge) exceptions++;
    }

    const count = wrap?.querySelector('#cxScoutNoiseCount');
    if (count) {
      if (!hide) count.textContent = 'Showing all Market prices';
      else count.textContent = `${hidden} sub-$2 ${hidden === 1 ? 'card' : 'cards'} hidden${exceptions ? ` • ${exceptions} true surge exception${exceptions === 1 ? '' : 's'}` : ''}`;
    }
  }

  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }

  const style = document.createElement('style');
  style.textContent = `
    .cx-scout-low-hidden{display:none!important}
    .cx-scout-noise-filter{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 12px;padding:9px 11px;border:1px solid var(--cx-line);border-radius:12px;background:var(--cx-card);color:var(--cx-text)}
    .cx-scout-noise-filter label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;cursor:pointer}
    .cx-scout-noise-filter input{width:17px;height:17px;accent-color:var(--cx-blue,#2f6df6)}
    .cx-scout-noise-filter small{color:var(--cx-muted);font-size:10px;text-align:right}
    @media(max-width:640px){.cx-scout-noise-filter{align-items:flex-start;flex-direction:column;gap:4px}.cx-scout-noise-filter small{text-align:left}}
  `;
  document.head.appendChild(style);

  const mo = new MutationObserver(muts => {
    if (muts.some(m => m.target.id === 'cxParityCards' || m.target.closest?.('#cxScout'))) schedule();
    if (document.getElementById('cxParityCards') && !meta.size && !loading) loadMeta();
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('click',e => {
    if (e.target.closest?.('[data-cx-page="scout"]')) setTimeout(() => { ensureUi(); loadMeta(); }, 100);
  },true);

  setTimeout(() => { ensureUi(); loadMeta(); }, 100);
})();
