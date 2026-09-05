import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const API = 'https://api.tcgplayer.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase_${r.status}_${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function authorized(req: Request) {
  const key = req.headers.get('x-collectish-cron-key') || '';
  if (!key) return false;
  const rows = await sb('collectish_internal_job_secrets?select=secret_value&name=eq.tcgplayer_price_cron&limit=1');
  return !!rows?.[0]?.secret_value && key === rows[0].secret_value;
}

async function tcgToken() {
  const a = Deno.env.get('TCGPLAYER_PUBLIC_KEY');
  const b = Deno.env.get('TCGPLAYER_PRIVATE_KEY');
  if (!a || !b) throw new Error('missing_tcgplayer_secrets');
  const r = await fetch(`${API}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: a, client_secret: b }),
  });
  if (!r.ok) throw new Error(`tcg_token_${r.status}`);
  return (await r.json()).access_token as string;
}

async function state(scope: string) {
  const r = await sb(`tcgplayer_official_sync_state?select=*&scope=eq.${encodeURIComponent(scope)}&limit=1`);
  return r?.[0] || { scope, next_offset: 0, batch_size: 500 };
}

async function setState(scope: string, patch: any) {
  await sb(`tcgplayer_official_sync_state?scope=eq.${encodeURIComponent(scope)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function syncSkuScope(scope: string, offset: number, limit: number, token: string) {
  const path = scope === 'sealed_components'
    ? `tcgplayer_official_component_price_candidates?select=sku_id,product_id&order=sku_id.asc&offset=${offset}&limit=${limit}`
    : `scout_opportunities_24h?select=sku_id,product_id&order=sku_id.asc&offset=${offset}&limit=${limit}`;
  const candidates = await sb(path);
  const bySku = new Map<string, string>();
  for (const x of candidates || []) if (x.sku_id && !bySku.has(String(x.sku_id))) bySku.set(String(x.sku_id), String(x.product_id || ''));
  const ids = [...bySku.keys()];
  if (!ids.length) return { candidateCount: candidates?.length || 0, requested: 0, written: 0 };

  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const r = await fetch(`${API}/pricing/sku/${part.join(',')}`, { headers: { Authorization: `bearer ${token}` } });
    if (!r.ok) throw new Error(`pricing_sku_${r.status}`);
    const j = await r.json();
    for (const x of j.results || []) rows.push({
      sku_id: String(x.skuId),
      product_id: bySku.get(String(x.skuId)) || null,
      low_price: x.lowPrice,
      lowest_shipping: x.lowestShipping,
      lowest_listing_price: x.lowestListingPrice,
      market_price: x.marketPrice,
      direct_low_price: x.directLowPrice,
      observed_at: new Date().toISOString(),
      source: 'tcgplayer_official',
    });
  }
  if (rows.length) {
    await sb('tcgplayer_official_sku_price_current?on_conflict=sku_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    const hist = rows.map(x => ({ ...x, observed_hour: new Date(x.observed_at).toISOString().slice(0, 13) + ':00:00.000Z' }));
    await sb('tcgplayer_official_sku_price_history?on_conflict=sku_id,observed_hour', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(hist),
    });
  }
  return { candidateCount: candidates?.length || 0, requested: ids.length, written: rows.length };
}

async function syncSealedProducts(offset: number, limit: number, token: string, requestedProductIds: string[] = []) {
  const candidateFilter = requestedProductIds.length
    ? `tcgplayer_product_id=in.(${requestedProductIds.join(',')})`
    : `order=tcgplayer_product_id.asc&offset=${offset}&limit=${limit}`;
  const candidates = await sb(`mtgjson_sealed_products?select=uuid,name,tcgplayer_product_id&tcgplayer_product_id=not.is.null&${candidateFilter}`);
  const byProduct = new Map<string, any>();
  for (const x of candidates || []) if (x.tcgplayer_product_id && !byProduct.has(String(x.tcgplayer_product_id))) byProduct.set(String(x.tcgplayer_product_id), x);
  const ids = [...byProduct.keys()];
  if (!ids.length) return { candidateCount: candidates?.length || 0, requested: 0, written: 0 };

  const collected = new Map<string, any[]>();
  const skuProduct = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const headers = { Authorization: `bearer ${token}` };
    const [r, catalog] = await Promise.all([
      fetch(`${API}/pricing/product/${part.join(',')}`, { headers }),
      fetch(`${API}/catalog/products/${part.join(',')}?includeSkus=true`, { headers }),
    ]);
    if (!r.ok && r.status !== 207) throw new Error(`pricing_product_${r.status}`);
    if (!catalog.ok && catalog.status !== 207) throw new Error(`catalog_product_${catalog.status}`);
    const j = await r.json();
    for (const x of j.results || []) {
      const k = String(x.productId);
      if (!collected.has(k)) collected.set(k, []);
      collected.get(k)!.push(x);
    }
    const detail = await catalog.json();
    for (const product of detail.results || []) {
      const productId = String(product.productId);
      const skus = Array.isArray(product.skus) ? product.skus : [];
      const english = skus.filter((sku: any) => Number(sku.languageId) === 1);
      for (const sku of english.length ? english : skus) {
        if (sku?.skuId != null) skuProduct.set(String(sku.skuId), productId);
      }
    }
  }

  const landedByProduct = new Map<string, any>();
  const skuIds = [...skuProduct.keys()];
  for (let i = 0; i < skuIds.length; i += 50) {
    const part = skuIds.slice(i, i + 50);
    const r = await fetch(`${API}/pricing/sku/${part.join(',')}`, { headers: { Authorization: `bearer ${token}` } });
    if (!r.ok && r.status !== 207) throw new Error(`pricing_sku_${r.status}`);
    const j = await r.json();
    for (const x of j.results || []) {
      const pid = skuProduct.get(String(x.skuId));
      const landed = Number(x.lowestListingPrice);
      if (!pid || !Number.isFinite(landed) || landed <= 0) continue;
      const prior = landedByProduct.get(pid);
      if (!prior || landed < Number(prior.lowestListingPrice)) landedByProduct.set(pid, x);
    }
  }

  const observed_at = new Date().toISOString();
  const rows: any[] = [];
  for (const [pid, vals] of collected) {
    const c = vals.find((x: any) => String(x.subTypeName || '').toLowerCase() === 'normal' && (x.marketPrice != null || x.lowPrice != null))
      || vals.find((x: any) => x.marketPrice != null || x.lowPrice != null)
      || vals[0];
    const meta = byProduct.get(pid);
    if (!c || !meta) continue;
    const landed = landedByProduct.get(pid);
    rows.push({
      sealed_uuid: meta.uuid,
      source: 'tcgplayer_official_product',
      product_id: pid,
      product_name: meta.name || null,
      market_price: c.marketPrice,
      low_price: c.lowPrice,
      low_with_shipping: landed?.lowestListingPrice ?? null,
      total_listings: null,
      captured_at: observed_at,
      raw_json: {
        provider: 'tcgplayer_official',
        endpoint: 'pricing/product',
        subTypeName: c.subTypeName || null,
        directLowPrice: c.directLowPrice ?? null,
        midPrice: c.midPrice ?? null,
        highPrice: c.highPrice ?? null,
        shippingAware: landed?.lowestListingPrice != null,
        skuId: landed?.skuId ?? null,
        lowestShipping: landed?.lowestShipping ?? null,
        lowestListingPrice: landed?.lowestListingPrice ?? null,
      },
    });
  }
  if (rows.length) await sb('sealed_product_price_current?on_conflict=sealed_uuid,source', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  return { candidateCount: candidates?.length || 0, requested: ids.length, written: rows.length };
}

Deno.serve(async req => {
  if (!(await authorized(req))) return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
  let scope = 'scout';
  try {
    const u = new URL(req.url);
    scope = (u.searchParams.get('scope') || 'scout').toLowerCase();
    if (!['scout', 'sealed_components', 'sealed_products'].includes(scope)) throw new Error('invalid_scope');
    const mode = (u.searchParams.get('mode') || 'next').toLowerCase();
    const st = await state(scope);
    const offset = mode === 'next' ? Number(st.next_offset || 0) : Math.max(0, Number(u.searchParams.get('offset') || 0));
    const limit = Math.max(1, Math.min(500, mode === 'next' ? Number(st.batch_size || 500) : Number(u.searchParams.get('limit') || 500)));
    await setState(scope, { last_started_at: new Date().toISOString(), last_error: null });
    const token = await tcgToken();
    const productIds = (u.searchParams.get('product_ids') || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).slice(0, 50);
    const result = scope === 'sealed_products' ? await syncSealedProducts(offset, limit, token, productIds) : await syncSkuScope(scope, offset, limit, token);
    const next = result.candidateCount < limit ? 0 : offset + limit;
    await setState(scope, { next_offset: next, last_completed_at: new Date().toISOString(), last_requested: result.requested, last_written: result.written, last_error: null });
    return new Response(JSON.stringify({ ok: true, scope, offset, limit, ...result, next_offset: next }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    await setState(scope, { last_completed_at: new Date().toISOString(), last_error: String((e as any)?.message || e) }).catch(() => {});
    return new Response(JSON.stringify({ ok: false, scope, error: String((e as any)?.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
