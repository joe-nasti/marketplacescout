import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const API = "https://api.tcgplayer.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const urlBase = () => String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const anonKey = () => String(Deno.env.get("SUPABASE_ANON_KEY") || "");
const serviceKey = () => String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
let cachedToken: string | null = null;
let cachedUntil = 0;
const skuFetchInflight = new Map<string, Promise<any>>();
const MATRIX_TTL_MS = 6*60*60*1000;
const NEGATIVE_TTL_MS = 60*60*1000;

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
async function rest(path: string, init: RequestInit = {}) {
  const body=init.body!=null&&typeof init.body!=="string"?JSON.stringify(init.body):init.body;
  const r = await fetch(`${urlBase()}/rest/v1/${path}`, { ...init, ...(body!=null?{body}:{}), headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const raw = await r.text(); let data: any = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!r.ok) throw new Error(data?.message || `Supabase REST ${r.status}`); return data;
}
async function tcgToken() {
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;
  const clientId = Deno.env.get("TCGPLAYER_PUBLIC_KEY"), clientSecret = Deno.env.get("TCGPLAYER_PRIVATE_KEY");
  if (!clientId || !clientSecret) throw new Error("missing_tcgplayer_secrets");
  const r = await fetch(`${API}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }) });
  if (!r.ok) throw new Error(`tcg_token_${r.status}`); const j = await r.json(); cachedToken = j.access_token; cachedUntil = Date.now() + Math.max(60000, (Number(j.expires_in || 3600) - 60) * 1000); return cachedToken!;
}
async function apiJson(path: string, token: string) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `bearer ${token}`, Accept: "application/json" } });
  const raw = await r.text(); let data: any = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!r.ok && r.status !== 207) throw new Error(`tcg_${r.status}_${path}`); return data;
}
function normCondition(v: unknown) { const s = String(v || "").trim().toUpperCase(); if (s === "NM" || s === "NEAR MINT") return "NEAR MINT"; if (s === "LP" || s === "LIGHTLY PLAYED") return "LIGHTLY PLAYED"; if (s === "MP" || s === "MODERATELY PLAYED") return "MODERATELY PLAYED"; if (s === "HP" || s === "HEAVILY PLAYED") return "HEAVILY PLAYED"; if (s === "DAMAGED" || s === "DMG") return "DAMAGED"; return s || null; }
function normLanguage(v: unknown) { const s = String(v || "").trim().toUpperCase(); if (s === "EN" || s === "ENGLISH") return "ENGLISH"; return s || null; }
function normPrinting(v: unknown) { const s = String(v || "").trim(); if (!s) return null; const u = s.toUpperCase(); if (/NON[- ]?FOIL|NORMAL/.test(u)) return "NON FOIL"; if (/ETCHED/.test(u)) return "ETCHED FOIL"; if (/FOIL/.test(u)) return "FOIL"; return u; }
function finishMatches(printing: string | null, desired: string | null) { if (!desired) return true; const d = desired.toLowerCase(), p = String(printing || "").toLowerCase(); if (d.includes("non") || d === "normal" || d === "regular") return p.includes("non foil"); if (d.includes("etched")) return p.includes("etched"); if (d.includes("foil")) return p.includes("foil") && !p.includes("non foil"); return p.includes(d); }
function requestedLabel(desiredFinish: string | null) { if (!desiredFinish) return "requested variant"; const d = desiredFinish.toLowerCase(); if (d.includes("etched")) return "etched foil"; if (d.includes("foil") && !d.includes("non")) return "foil"; if (d.includes("non") || d === "normal" || d === "regular") return "nonfoil"; return desiredFinish; }
function negativeKey(productId: string, desiredFinish: string | null, desiredCondition: string | null, desiredLanguage: string | null) { return [productId, normPrinting(desiredFinish) || "ANY", desiredCondition || "ANY", desiredLanguage || "ANY"].join("|"); }
function negativeSkuId(key: string) { return `negative:${key}`; }
function validNegative(row: any, key: string) { const raw = row?.raw_json || {}; return row?.source === "discovery_negative" && raw?.cache_key === key && Number(new Date(raw?.expires_at || 0)) > Date.now() ? raw : null; }
function discoveryOutcome(records: any[], wanted: any[], desiredFinish: string | null, desiredCondition: string | null, desiredLanguage: string | null) {
  if (!desiredFinish) return { code: "catalog_discovered", provider_variant_available: null, message: "TCGplayer SKU matrix checked and all available NM English siblings were discovered." };
  if (wanted.length) return { code: "matched", provider_variant_available: true, message: `TCGplayer exposes ${wanted.length} matching ${requestedLabel(desiredFinish)} SKU${wanted.length === 1 ? "" : "s"}.` };
  const finishRows = records.filter((x: any) => finishMatches(x.printing, desiredFinish));
  const exactConditionRows = finishRows.filter((x: any) => !desiredCondition || x.condition === desiredCondition);
  if (!finishRows.length) return { code: "provider_finish_absent", provider_variant_available: false, message: `TCGplayer does not expose a ${requestedLabel(desiredFinish)} SKU for this product.` };
  if (!exactConditionRows.length || !finishRows.some((x: any) => (!desiredCondition || x.condition === desiredCondition) && (!desiredLanguage || x.language === desiredLanguage))) { const condition = desiredCondition === "NEAR MINT" ? "NM" : desiredCondition || "requested-condition"; const language = desiredLanguage === "ENGLISH" ? "English" : desiredLanguage || "requested-language"; return { code: "provider_condition_language_absent", provider_variant_available: false, message: `TCGplayer does not expose an ${condition} ${language} ${requestedLabel(desiredFinish)} SKU for this product.` }; }
  return { code: "provider_variant_absent", provider_variant_available: false, message: `TCGplayer does not expose the requested ${requestedLabel(desiredFinish)} SKU for this product.` };
}
async function fetchOfficialSkus(productId: string) {
  const token = await tcgToken();
  const [skuDoc, condDoc, langDoc, printDoc] = await Promise.all([
    apiJson(`/catalog/products/${encodeURIComponent(productId)}/skus`, token),
    apiJson('/catalog/categories/1/conditions', token),
    apiJson('/catalog/categories/1/languages', token),
    apiJson('/catalog/categories/1/printings', token),
  ]);
  const cond = new Map((condDoc?.results || []).map((x: any) => [Number(x.conditionId), x.name || x.abbreviation]));
  const lang = new Map((langDoc?.results || []).map((x: any) => [Number(x.languageId), x.name || x.abbr]));
  const printing = new Map((printDoc?.results || []).map((x: any) => [Number(x.printingId), x.name]));
  const skus = Array.isArray(skuDoc?.results) ? skuDoc.results : [];
  if (!skus.length) throw new Error('official_catalog_no_skus');
  if (skus.some((x: any) => !cond.get(Number(x.conditionId)) || !lang.get(Number(x.languageId)) || !printing.get(Number(x.printingId ?? x.variantId)))) throw new Error('official_catalog_unresolved_sku_metadata');
  return skus.map((x: any) => ({ skuId: x.skuId, variant: printing.get(Number(x.printingId ?? x.variantId)), condition: cond.get(Number(x.conditionId)), language: lang.get(Number(x.languageId)), raw: x }));
}
function extractDetail(payload: any) { if (!payload) return {}; if (payload?.result && typeof payload.result === "object") return payload.result; if (payload?.data && !Array.isArray(payload.data) && typeof payload.data === "object") return payload.data; return payload; }
function extractSkus(detail: any) { const list = detail?.skus || detail?.skuList || detail?.sku || detail?.productSkus || []; return Array.isArray(list) ? list : []; }
async function fetchMarketplaceSkus(productId: string) {
  const headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; Collectish/1.0; +https://collectish.com)", Origin: "https://www.tcgplayer.com", Referer: `https://www.tcgplayer.com/product/${productId}` };
  const endpoints = [`https://mp-search-api.tcgplayer.com/v2/product/${encodeURIComponent(productId)}/details`, `https://mp-search-api.tcgplayer.com/v1/product/${encodeURIComponent(productId)}/details`]; let last = "";
  for (const endpoint of endpoints) { try { const r = await fetch(endpoint, { headers }); const raw = await r.text(); last = `${r.status}: ${raw.slice(0,240)}`; if (!r.ok) continue; let payload: any = null; try { payload = JSON.parse(raw); } catch { continue; } const detail = extractDetail(payload); const skus = extractSkus(detail); if (skus.length) return { endpoint, rows: skus.map((sku: any) => ({ skuId: sku?.sku ?? sku?.skuId ?? sku?.skuID ?? sku?.id, variant: sku?.variant ?? sku?.variantName ?? sku?.printing ?? sku?.printingType ?? sku?.finish, condition: sku?.condition ?? sku?.conditionName ?? sku?.conditionType, language: sku?.language ?? sku?.languageName, raw: sku })) }; } catch (e) { last = String(e); } }
  throw new Error(`TCGplayer product details unavailable (${last})`);
}
async function fetchSkus(productId: string) {
  try { return { endpoint: `${API}/catalog/products/${encodeURIComponent(productId)}/skus`, source: 'tcgplayer_official_catalog', rows: await fetchOfficialSkus(productId), fallback_reason: null }; }
  catch (officialError) { const fallback = await fetchMarketplaceSkus(productId); return { ...fallback, source: 'tcgplayer_marketplace_fallback', fallback_reason: String((officialError as Error)?.message || officialError) }; }
}
async function fetchSkusCoalesced(productId: string) {
  if (skuFetchInflight.has(productId)) return skuFetchInflight.get(productId)!;
  const job = fetchSkus(productId).finally(() => skuFetchInflight.delete(productId));
  skuFetchInflight.set(productId, job);
  return job;
}
async function anchorForProduct(productId: string) {
  const catalog = await rest(`scout_card_catalog?product_id=eq.${encodeURIComponent(productId)}&select=mtgjson_uuid,product_id,scryfall_id,card_name,set_code,collector_number,release_date&limit=1`).catch(() => []); if (Array.isArray(catalog) && catalog[0]?.mtgjson_uuid) return catalog[0];
  const direct = await rest(`mtgjson_cards?tcgplayer_product_id=eq.${encodeURIComponent(productId)}&select=uuid,tcgplayer_product_id,scryfall_id,name,set_code,collector_number,release_date&limit=1`).catch(() => []); const d = Array.isArray(direct) ? direct[0] : null; if (d?.uuid) return { mtgjson_uuid: d.uuid, product_id: productId, scryfall_id: d.scryfall_id, card_name: d.name, set_code: d.set_code, collector_number: d.collector_number, release_date: d.release_date };
  const skus = await rest(`mtgjson_tcgplayer_skus?product_id=eq.${encodeURIComponent(productId)}&select=uuid,product_id&limit=1`).catch(() => []); const uuid = Array.isArray(skus) ? skus[0]?.uuid : null; if (!uuid) return null;
  const cards = await rest(`mtgjson_cards?uuid=eq.${encodeURIComponent(uuid)}&select=uuid,scryfall_id,name,set_code,collector_number,release_date&limit=1`).catch(() => []); const c = Array.isArray(cards) ? cards[0] : null; if (!c) return null;
  return { mtgjson_uuid: c.uuid, product_id: productId, scryfall_id: c.scryfall_id, card_name: c.name, set_code: c.set_code, collector_number: c.collector_number, release_date: c.release_date };
}
async function verifiedEphemeralAnchor(productId: string, supplied: any) {
  if (!supplied || !/^[0-9a-f-]{36}$/i.test(String(supplied.scryfall_id || '')) || !String(supplied.card_name || '').trim()) return null;
  const family = await rest('rpc/ask_collectish_supply_family_products_v1', { method: 'POST', body: JSON.stringify({ p_scryfall_id: supplied.scryfall_id, p_card_name: supplied.card_name }) }).catch(() => []);
  const match = Array.isArray(family) ? family.find((row: any) => String(row?.product_id || '') === productId && String(row?.scryfall_id || '').toLowerCase() === String(supplied.scryfall_id).toLowerCase()) : null;
  return match ? { mtgjson_uuid: null, product_id: productId, scryfall_id: match.scryfall_id, card_name: match.card_name, set_code: match.set_code, collector_number: match.collector_number, release_date: match.release_date || null } : null;
}
async function queueRefreshAsCaller(authHeader: string | null, skuId: string, reason: string) { if (!authHeader) return null; try { const r = await fetch(`${urlBase()}/rest/v1/rpc/request_scout_refresh`, { method: "POST", headers: { apikey: anonKey(), Authorization: authHeader, "Content-Type": "application/json" }, body: JSON.stringify({ p_sku_id: skuId, p_reason: reason, p_priority: 95 }) }); if (!r.ok) return null; const data = await r.json().catch(() => null); return Array.isArray(data) ? data[0] || null : data; } catch { return null; } }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors }); if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({})); const productId = String(body?.product_id || body?.productId || "").trim(); const desiredFinish = body?.desired_finish ? String(body.desired_finish) : body?.printing ? String(body.printing) : null; const requestedConditions = Array.isArray(body?.desired_conditions) ? body.desired_conditions : [body?.desired_condition || body?.condition || "NEAR MINT"]; const desiredConditions = [...new Set(requestedConditions.map(normCondition).filter(Boolean))]; const desiredCondition = desiredConditions[0] || "NEAR MINT"; const desiredLanguage = normLanguage(body?.desired_language || body?.language || "ENGLISH"); const force = Boolean(body?.force); const persist = body?.persist !== false; const persistMatchesOnly = body?.persist_matches_only === true; const reason = String(body?.reason || "on_demand_sku_discovery"); if (!/^\d+$/.test(productId)) return json({ error: "product_id is required" }, 400);
    const supplied = body?.known_identity && typeof body.known_identity === 'object' ? body.known_identity : null;
    const ephemeralAnchor = !persist ? await verifiedEphemeralAnchor(productId, supplied) : null;
    const anchor = await anchorForProduct(productId) || ephemeralAnchor; if (!anchor || (!anchor.mtgjson_uuid && !ephemeralAnchor)) return json({ error: "Known MTG card identity is required before SKU discovery", product_id: productId }, 404);
    const freshCutoff = new Date(Date.now() - MATRIX_TTL_MS).toISOString(); let cachedRows = await rest(`scout_tcgplayer_sku_discovery_cache?product_id=eq.${encodeURIComponent(productId)}&last_seen_at=gte.${encodeURIComponent(freshCutoff)}&select=*&order=sku_id.asc`).catch(() => []); if (!Array.isArray(cachedRows)) cachedRows = [];
    const cacheKey = negativeKey(productId, desiredFinish, desiredConditions.join(',') || desiredCondition, desiredLanguage), negative = !force && desiredFinish ? cachedRows.map((x: any) => validNegative(x, cacheKey)).find(Boolean) || null : null;
    const cached = cachedRows.filter((x: any) => x?.source !== "discovery_negative");
    const cachedMatch = desiredConditions.every((c: string) => cached.some((x: any) => finishMatches(x.printing, desiredFinish) && x.condition === c && (!desiredLanguage || x.language === desiredLanguage)));
    let endpoint: string | null = null, source = 'cache', fallbackReason: string | null = null, records: any[] = cached;
    if (!negative && (force || !cached.length || !cachedMatch)) {
      const fetched = await fetchSkusCoalesced(productId); endpoint = fetched.endpoint; source = fetched.source; fallbackReason = fetched.fallback_reason; const now = new Date().toISOString();
      records = fetched.rows.map((sku: any) => { const skuId = String(sku?.skuId ?? "").trim(); const variant = String(sku?.variant ?? "").trim(); return { sku_id: skuId, product_id: productId, card_name: anchor.card_name, set_code: anchor.set_code, collector_number: anchor.collector_number, variant: variant || null, printing: normPrinting(variant), condition: normCondition(sku?.condition), language: normLanguage(sku?.language), mtgjson_uuid: anchor.mtgjson_uuid, scryfall_id: anchor.scryfall_id, source, raw_json: sku?.raw || sku, last_seen_at: now }; }).filter((x: any) => /^\d+$/.test(x.sku_id));
      const persistedRecords=persistMatchesOnly?records.filter((x:any)=>desiredConditions.includes(x.condition)&&(!desiredLanguage||x.language===desiredLanguage)):records;
      if (persist && persistedRecords.length) await rest("scout_tcgplayer_sku_discovery_cache?on_conflict=sku_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: persistedRecords });
    }
    const english = records.filter((x: any) => !x.language || x.language === "ENGLISH"), materialized: any[] = [];
    if (persist) for (const x of english) { if (x.condition !== "NEAR MINT" || x.catalog_materialized_at) continue; const row = { sku_id: x.sku_id, mtgjson_uuid: anchor.mtgjson_uuid, product_id: productId, scryfall_id: anchor.scryfall_id, card_name: anchor.card_name, set_code: anchor.set_code, collector_number: anchor.collector_number, printing: x.printing, finish: x.variant || null, condition: "NEAR MINT", language: "ENGLISH", release_date: anchor.release_date, source_updated_at: new Date().toISOString() }; await rest("scout_card_catalog?on_conflict=sku_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: row }); materialized.push(row); await rest(`scout_tcgplayer_sku_discovery_cache?sku_id=eq.${encodeURIComponent(x.sku_id)}`, { method: "PATCH", body: { catalog_materialized_at: new Date().toISOString() } }).catch(() => null); }
    const wanted = english.filter((x: any) => finishMatches(x.printing, desiredFinish) && desiredConditions.includes(x.condition) && (!desiredLanguage || x.language === desiredLanguage)); const outcome = negative?.outcome || discoveryOutcome(records, wanted, desiredFinish, desiredCondition, desiredLanguage);
    if (persist && desiredFinish) { const sentinel = negativeSkuId(cacheKey); if (wanted.length) await rest(`scout_tcgplayer_sku_discovery_cache?sku_id=eq.${encodeURIComponent(sentinel)}`, { method: "DELETE" }).catch(() => null); else if (outcome?.provider_variant_available === false && !negative) { const now = new Date(), expires = new Date(now.getTime() + NEGATIVE_TTL_MS); await rest("scout_tcgplayer_sku_discovery_cache?on_conflict=sku_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [{ sku_id: sentinel, product_id: productId, card_name: anchor.card_name, set_code: anchor.set_code, collector_number: anchor.collector_number, mtgjson_uuid: anchor.mtgjson_uuid, scryfall_id: anchor.scryfall_id, source: "discovery_negative", raw_json: { cache_key: cacheKey, outcome, expires_at: expires.toISOString() }, last_seen_at: now.toISOString() }] }); } }
    const queued: any[] = [], authHeader = req.headers.get("Authorization"); if (persist) for (const x of wanted) { if (x.condition !== "NEAR MINT") continue; const q = await queueRefreshAsCaller(authHeader, x.sku_id, reason); if (q) queued.push({ sku_id: x.sku_id, ...q }); }
    return json({ ok: true, product_id: productId, card: anchor, source_endpoint: endpoint, source: negative ? 'negative_cache' : source, fallback_reason: fallbackReason, cache_used: !endpoint, negative_cache_used: Boolean(negative), discovered_count: records.length, english_count: english.length, materialized_nm_english_count: materialized.length, persist_matches_only: persistMatchesOnly, requested_finish: desiredFinish, requested_condition: desiredCondition, requested_conditions: desiredConditions, requested_language: desiredLanguage, outcome, matches: wanted, queued_refreshes: queued, available_nm_english_printings: [...new Set(english.filter((x: any) => x.condition === "NEAR MINT").map((x: any) => x.printing).filter(Boolean))] });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});
