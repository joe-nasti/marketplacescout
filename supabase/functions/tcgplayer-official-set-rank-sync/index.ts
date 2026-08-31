import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const API = "https://api.tcgplayer.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let cachedToken: string | null = null;
let cachedUntil = 0;

async function tcgToken() {
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;
  const clientId = Deno.env.get("TCGPLAYER_PUBLIC_KEY");
  const clientSecret = Deno.env.get("TCGPLAYER_PRIVATE_KEY");
  if (!clientId || !clientSecret) throw new Error("missing_tcgplayer_secrets");
  const r = await fetch(`${API}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!r.ok) throw new Error(`tcg_token_${r.status}`);
  const j = await r.json();
  cachedToken = j.access_token;
  cachedUntil = Date.now() + Math.max(60_000, (Number(j.expires_in || 3600) - 60) * 1000);
  return cachedToken!;
}

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase_${r.status}_${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function apiJson(url: string, token: string, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok && r.status !== 207) throw new Error(`tcg_${r.status}_${url}`);
  return r.json();
}

async function searchIds(setName: string, token: string) {
  const result = await apiJson(`${API}/catalog/categories/1/search`, token, {
    method: "POST",
    body: JSON.stringify({ sort: "Sales DESC", limit: 250, offset: 0, filters: [{ name: "SetName", values: [setName] }] }),
  });
  return (result.results || []).map((x: any) => Number(typeof x === "number" ? x : x?.productId)).filter(Boolean);
}

async function productDetails(ids: number[], token: string) {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const result = await apiJson(`${API}/catalog/products/${ids.slice(i, i + 100).join(",")}`, token);
    rows.push(...(result.results || []));
  }
  return rows;
}

async function syncGroup(group: any, token: string) {
  const names = [group.tcgplayer_name, group.name].filter((x: any, i: number, all: any[]) => x && all.indexOf(x) === i);
  let filtered: number[] = [];
  let productsById = new Map<number, any>();

  for (const name of names) {
    const ids = await searchIds(name, token);
    if (!ids.length) continue;
    const products = await productDetails(ids, token);
    productsById = new Map(products.map((p: any) => [Number(p.productId), p]));
    filtered = ids.filter((id: number) => Number(productsById.get(id)?.groupId) === Number(group.tcgplayer_group_id));
    if (filtered.length) break;
  }

  const observedAt = new Date().toISOString();
  const top = filtered.slice(0, 100).map((productId: number, i: number) => ({
    tcgplayer_group_id: Number(group.tcgplayer_group_id),
    product_id: String(productId),
    sales_rank: i + 1,
    set_code: group.code || null,
    set_name: group.tcgplayer_name || group.name || null,
    product_name: productsById.get(productId)?.name || null,
    observed_at: observedAt,
    source: "tcgplayer_official_search",
  }));
  if (!top.length) return { group: group.tcgplayer_group_id, rows: 0 };

  await sb("tcgplayer_set_sales_rank_current", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(top) });
  await sb(`tcgplayer_set_sales_rank_current?tcgplayer_group_id=eq.${group.tcgplayer_group_id}&product_id=not.in.(${top.map(x => x.product_id).join(",")})`, { method: "DELETE" });
  await sb("tcgplayer_set_sales_rank_history", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(top.map(x => ({ ...x, observed_date: observedAt.slice(0, 10) }))) });
  return { group: group.tcgplayer_group_id, rows: top.length };
}

async function getGroups() {
  const profiles = await sb("marketplace_scan_profiles?select=tcgplayer_group_id&enabled=eq.true&tcgplayer_group_id=not.is.null&order=tcgplayer_group_id.asc");
  const ids = [...new Set((profiles || []).map((x: any) => Number(x.tcgplayer_group_id)).filter(Boolean))];
  if (!ids.length) return [];
  return sb(`magic_set_catalog?select=code,name,tcgplayer_group_id,tcgplayer_name&tcgplayer_group_id=in.(${ids.join(",")})&order=tcgplayer_group_id.asc`);
}

Deno.serve(async req => {
  try {
    const u = new URL(req.url);
    const limit = Math.max(1, Math.min(20, Number(u.searchParams.get("limit") || 10)));
    const offset = Math.max(0, Number(u.searchParams.get("offset") || 0));
    const groups = await getGroups();
    const slice = groups.slice(offset, offset + limit);
    const token = await tcgToken();
    const results = [];
    for (const group of slice) {
      try { results.push(await syncGroup(group, token)); }
      catch (e) { results.push({ group: group.tcgplayer_group_id, error: String((e as any)?.message || e) }); }
    }
    return new Response(JSON.stringify({ ok: true, offset, limit, groups: slice.length, source: "tcgplayer_official_catalog", results }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message || e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
