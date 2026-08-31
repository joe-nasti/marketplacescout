import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const urlBase = () => String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const anonKey = () => String(Deno.env.get("SUPABASE_ANON_KEY") || "");
const serviceKey = () => String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${urlBase()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await r.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!r.ok) throw new Error(data?.message || `Supabase REST ${r.status}`);
  return data;
}

function normCondition(v: unknown) {
  const s = String(v || "").trim().toUpperCase();
  if (s === "NM" || s === "NEAR MINT") return "NEAR MINT";
  if (s === "LP" || s === "LIGHTLY PLAYED") return "LIGHTLY PLAYED";
  if (s === "MP" || s === "MODERATELY PLAYED") return "MODERATELY PLAYED";
  if (s === "HP" || s === "HEAVILY PLAYED") return "HEAVILY PLAYED";
  if (s === "DAMAGED" || s === "DMG") return "DAMAGED";
  return s || null;
}

function normLanguage(v: unknown) {
  const s = String(v || "").trim().toUpperCase();
  if (s === "EN" || s === "ENGLISH") return "ENGLISH";
  return s || null;
}

function normPrinting(v: unknown) {
  const s = String(v || "").trim();
  if (!s) return null;
  const u = s.toUpperCase();
  if (/NON[- ]?FOIL|NORMAL/.test(u)) return "NON FOIL";
  if (/ETCHED/.test(u)) return "ETCHED FOIL";
  if (/FOIL/.test(u)) return "FOIL";
  return u;
}

function finishMatches(printing: string | null, desired: string | null) {
  if (!desired) return true;
  const d = desired.toLowerCase();
  const p = String(printing || "").toLowerCase();
  if (d.includes("non") || d === "normal" || d === "regular") return p.includes("non foil");
  if (d.includes("etched")) return p.includes("etched");
  if (d.includes("foil")) return p.includes("foil") && !p.includes("non foil");
  return p.includes(d);
}

function requestedLabel(desiredFinish: string | null) {
  if (!desiredFinish) return "requested variant";
  const d = desiredFinish.toLowerCase();
  if (d.includes("etched")) return "etched foil";
  if (d.includes("foil") && !d.includes("non")) return "foil";
  if (d.includes("non") || d === "normal" || d === "regular") return "nonfoil";
  return desiredFinish;
}

function discoveryOutcome(records: any[], wanted: any[], desiredFinish: string | null, desiredCondition: string | null, desiredLanguage: string | null) {
  if (!desiredFinish) {
    return {
      code: "catalog_discovered",
      provider_variant_available: null,
      message: "TCGplayer SKU matrix checked and all available NM English siblings were discovered.",
    };
  }
  if (wanted.length) {
    return {
      code: "matched",
      provider_variant_available: true,
      message: `TCGplayer exposes ${wanted.length} matching ${requestedLabel(desiredFinish)} SKU${wanted.length === 1 ? "" : "s"}.`,
    };
  }

  const finishRows = records.filter((x: any) => finishMatches(x.printing, desiredFinish));
  const exactConditionRows = finishRows.filter((x: any) => !desiredCondition || x.condition === desiredCondition);
  if (!finishRows.length) {
    return {
      code: "provider_finish_absent",
      provider_variant_available: false,
      message: `TCGplayer does not expose a ${requestedLabel(desiredFinish)} SKU for this product.`,
    };
  }
  if (!exactConditionRows.length || !finishRows.some((x: any) => (!desiredCondition || x.condition === desiredCondition) && (!desiredLanguage || x.language === desiredLanguage))) {
    const condition = desiredCondition === "NEAR MINT" ? "NM" : desiredCondition || "requested-condition";
    const language = desiredLanguage === "ENGLISH" ? "English" : desiredLanguage || "requested-language";
    return {
      code: "provider_condition_language_absent",
      provider_variant_available: false,
      message: `TCGplayer does not expose an ${condition} ${language} ${requestedLabel(desiredFinish)} SKU for this product.`,
    };
  }
  return {
    code: "provider_variant_absent",
    provider_variant_available: false,
    message: `TCGplayer does not expose the requested ${requestedLabel(desiredFinish)} SKU for this product.`,
  };
}

function extractDetail(payload: any) {
  if (!payload) return {};
  if (payload?.result && typeof payload.result === "object") return payload.result;
  if (payload?.data && !Array.isArray(payload.data) && typeof payload.data === "object") return payload.data;
  return payload;
}

function extractSkus(detail: any) {
  const list = detail?.skus || detail?.skuList || detail?.sku || detail?.productSkus || [];
  return Array.isArray(list) ? list : [];
}

async function fetchDetails(productId: string) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; Collectish/1.0; +https://collectish.com)",
    Origin: "https://www.tcgplayer.com",
    Referer: `https://www.tcgplayer.com/product/${productId}`,
  };
  const endpoints = [
    `https://mp-search-api.tcgplayer.com/v2/product/${encodeURIComponent(productId)}/details`,
    `https://mp-search-api.tcgplayer.com/v1/product/${encodeURIComponent(productId)}/details`,
  ];
  let last = "";
  for (const endpoint of endpoints) {
    try {
      const r = await fetch(endpoint, { headers });
      const raw = await r.text();
      last = `${r.status}: ${raw.slice(0, 240)}`;
      if (!r.ok) continue;
      let payload: any = null;
      try { payload = JSON.parse(raw); } catch { continue; }
      const detail = extractDetail(payload);
      if (extractSkus(detail).length) return { detail, endpoint };
    } catch (e) {
      last = String(e);
    }
  }
  throw new Error(`TCGplayer product details unavailable (${last})`);
}

async function anchorForProduct(productId: string) {
  const catalog = await rest(`scout_card_catalog?product_id=eq.${encodeURIComponent(productId)}&select=mtgjson_uuid,product_id,scryfall_id,card_name,set_code,collector_number,release_date&limit=1`).catch(() => []);
  if (Array.isArray(catalog) && catalog[0]?.mtgjson_uuid) return catalog[0];

  const skus = await rest(`mtgjson_tcgplayer_skus?product_id=eq.${encodeURIComponent(productId)}&select=uuid,product_id&limit=1`).catch(() => []);
  const uuid = Array.isArray(skus) ? skus[0]?.uuid : null;
  if (!uuid) return null;
  const cards = await rest(`mtgjson_cards?uuid=eq.${encodeURIComponent(uuid)}&select=uuid,scryfall_id,name,set_code,collector_number,release_date&limit=1`).catch(() => []);
  const c = Array.isArray(cards) ? cards[0] : null;
  if (!c) return null;
  return {
    mtgjson_uuid: c.uuid,
    product_id: productId,
    scryfall_id: c.scryfall_id,
    card_name: c.name,
    set_code: c.set_code,
    collector_number: c.collector_number,
    release_date: c.release_date,
  };
}

async function queueRefreshAsCaller(authHeader: string | null, skuId: string, reason: string) {
  if (!authHeader) return null;
  try {
    const r = await fetch(`${urlBase()}/rest/v1/rpc/request_scout_refresh`, {
      method: "POST",
      headers: {
        apikey: anonKey(),
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_sku_id: skuId, p_reason: reason, p_priority: 95 }),
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return Array.isArray(data) ? data[0] || null : data;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const productId = String(body?.product_id || body?.productId || "").trim();
    const desiredFinish = body?.desired_finish ? String(body.desired_finish) : body?.printing ? String(body.printing) : null;
    const desiredCondition = normCondition(body?.desired_condition || body?.condition || "NEAR MINT");
    const desiredLanguage = normLanguage(body?.desired_language || body?.language || "ENGLISH");
    const force = Boolean(body?.force);
    const persist = body?.persist !== false;
    const reason = String(body?.reason || "on_demand_sku_discovery");
    if (!/^\d+$/.test(productId)) return json({ error: "product_id is required" }, 400);

    const anchor = await anchorForProduct(productId);
    if (!anchor?.mtgjson_uuid) return json({ error: "Known MTG card identity is required before SKU discovery", product_id: productId }, 404);

    const freshCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    let cached = await rest(`scout_tcgplayer_sku_discovery_cache?product_id=eq.${encodeURIComponent(productId)}&last_seen_at=gte.${encodeURIComponent(freshCutoff)}&select=*&order=sku_id.asc`).catch(() => []);
    if (!Array.isArray(cached)) cached = [];
    const cachedMatch = cached.some((x: any) => finishMatches(x.printing, desiredFinish) && (!desiredCondition || x.condition === desiredCondition) && (!desiredLanguage || x.language === desiredLanguage));

    let endpoint: string | null = null;
    let records: any[] = cached;
    if (force || !cached.length || (desiredFinish && !cachedMatch)) {
      const fetched = await fetchDetails(productId);
      endpoint = fetched.endpoint;
      const now = new Date().toISOString();
      records = extractSkus(fetched.detail).map((sku: any) => {
        const skuId = String(sku?.sku ?? sku?.skuId ?? sku?.skuID ?? sku?.id ?? "").trim();
        const variant = String(sku?.variant ?? sku?.variantName ?? sku?.printing ?? sku?.printingType ?? sku?.finish ?? "").trim();
        return {
          sku_id: skuId,
          product_id: productId,
          card_name: anchor.card_name,
          set_code: anchor.set_code,
          collector_number: anchor.collector_number,
          variant: variant || null,
          printing: normPrinting(variant),
          condition: normCondition(sku?.condition ?? sku?.conditionName ?? sku?.conditionType),
          language: normLanguage(sku?.language ?? sku?.languageName),
          mtgjson_uuid: anchor.mtgjson_uuid,
          scryfall_id: anchor.scryfall_id,
          source: "tcgplayer_product_details",
          raw_json: sku,
          last_seen_at: now,
        };
      }).filter((x: any) => /^\d+$/.test(x.sku_id));

      if (persist && records.length) {
        await rest("scout_tcgplayer_sku_discovery_cache?on_conflict=sku_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: records,
        });
      }
    }

    const english = records.filter((x: any) => !x.language || x.language === "ENGLISH");
    const materialized: any[] = [];
    if (persist) {
      for (const x of english) {
        if (x.condition !== "NEAR MINT") continue;
        const row = {
          sku_id: x.sku_id,
          mtgjson_uuid: anchor.mtgjson_uuid,
          product_id: productId,
          scryfall_id: anchor.scryfall_id,
          card_name: anchor.card_name,
          set_code: anchor.set_code,
          collector_number: anchor.collector_number,
          printing: x.printing,
          finish: x.variant || null,
          condition: "NEAR MINT",
          language: "ENGLISH",
          release_date: anchor.release_date,
          source_updated_at: new Date().toISOString(),
        };
        await rest("scout_card_catalog?on_conflict=sku_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: row,
        });
        materialized.push(row);
        await rest(`scout_tcgplayer_sku_discovery_cache?sku_id=eq.${encodeURIComponent(x.sku_id)}`, {
          method: "PATCH",
          body: { catalog_materialized_at: new Date().toISOString() },
        }).catch(() => null);
      }
    }

    const wanted = english.filter((x: any) => finishMatches(x.printing, desiredFinish) && (!desiredCondition || x.condition === desiredCondition) && (!desiredLanguage || x.language === desiredLanguage));
    const outcome = discoveryOutcome(records, wanted, desiredFinish, desiredCondition, desiredLanguage);
    const queued: any[] = [];
    const authHeader = req.headers.get("Authorization");
    for (const x of wanted) {
      if (x.condition !== "NEAR MINT") continue;
      const q = await queueRefreshAsCaller(authHeader, x.sku_id, reason);
      if (q) queued.push({ sku_id: x.sku_id, ...q });
    }

    return json({
      ok: true,
      product_id: productId,
      card: anchor,
      source_endpoint: endpoint,
      cache_used: !endpoint,
      discovered_count: records.length,
      english_count: english.length,
      materialized_nm_english_count: materialized.length,
      requested_finish: desiredFinish,
      requested_condition: desiredCondition,
      requested_language: desiredLanguage,
      outcome,
      matches: wanted,
      queued_refreshes: queued,
      available_nm_english_printings: [...new Set(english.filter((x: any) => x.condition === "NEAR MINT").map((x: any) => x.printing).filter(Boolean))],
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
