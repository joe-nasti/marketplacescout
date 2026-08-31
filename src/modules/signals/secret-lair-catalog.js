export const SECRET_LAIR_REGIONS = Object.freeze(['US', 'REU', 'UK']);
export const SECRET_LAIR_FINISHES = Object.freeze(['nonfoil', 'foil', 'other']);

const clean = (value) => String(value ?? '').trim();
const money = (value) => value == null || value === '' ? null : Number(value);
const iso = (value) => value ? new Date(value).toISOString() : null;

export function normalizeSecretLairRegion(region) {
  const value = clean(region).toUpperCase();
  if (!SECRET_LAIR_REGIONS.includes(value)) throw new Error(`Unsupported Secret Lair region: ${region}`);
  return value;
}

export function normalizeSecretLairCatalog(input = {}) {
  const release = input.release || input;
  const name = clean(release.release_name || release.name);
  if (!name) throw new Error('Secret Lair release name is required');

  const drops = (release.drops || []).map((drop) => {
    const dropName = clean(drop.drop_name || drop.name);
    if (!dropName) throw new Error('Every Secret Lair drop requires a name');
    return {
      drop_name: dropName,
      ip_name: clean(drop.ip_name) || null,
      artist_name: clean(drop.artist_name) || null,
      treatment_name: clean(drop.treatment_name) || null,
      wpn_nonfoil: Boolean(drop.wpn_nonfoil),
      mechanically_unique_count: Number(drop.mechanically_unique_count || 0),
      distribution_notes: clean(drop.distribution_notes) || null,
      cards: (drop.cards || []).map((card) => ({
        card_name: clean(card.card_name || card.name),
        display_name: clean(card.display_name) || null,
        scryfall_id: clean(card.scryfall_id) || null,
        oracle_id: clean(card.oracle_id) || null,
        is_token: Boolean(card.is_token),
        is_mechanically_unique: Boolean(card.is_mechanically_unique),
        is_bonus_card: Boolean(card.is_bonus_card),
        collector_number: clean(card.collector_number) || null,
        notes: clean(card.notes) || null,
      })).filter((card) => card.card_name),
      offers: (drop.offers || []).map(normalizeDropOffer),
    };
  });

  const regions = (release.regions || []).map((region) => ({
    region: normalizeSecretLairRegion(region.region),
    storefront_url: clean(region.storefront_url) || null,
    currency: clean(region.currency).toUpperCase(),
    sale_start_at: iso(region.sale_start_at),
    sale_end_at: iso(region.sale_end_at),
    queue_start_at: iso(region.queue_start_at),
    order_limit_notes: clean(region.order_limit_notes) || null,
    shipping_notes: clean(region.shipping_notes) || null,
    allocation_notes: clean(region.allocation_notes) || null,
    local_demand_notes: clean(region.local_demand_notes) || null,
  }));

  return {
    release_name: name,
    release_slug: clean(release.release_slug || release.slug) || null,
    official_url: clean(release.official_url) || null,
    announced_at: iso(release.announced_at),
    sale_start_at: iso(release.sale_start_at),
    sale_end_at: iso(release.sale_end_at),
    sale_format: clean(release.sale_format || 'unknown'),
    supply_confidence: release.supply_confidence == null ? 0.25 : Number(release.supply_confidence),
    supply_notes: clean(release.supply_notes) || null,
    preorder_or_queue_notes: clean(release.preorder_or_queue_notes) || null,
    promo_notes: clean(release.promo_notes) || null,
    bundle_notes: clean(release.bundle_notes) || null,
    lifecycle_state: clean(release.lifecycle_state || 'announced'),
    regions,
    drops,
    bundles: (release.bundles || []).map(normalizeBundle),
  };
}

export function normalizeDropOffer(offer = {}) {
  const finish = clean(offer.finish).toLowerCase();
  if (!SECRET_LAIR_FINISHES.includes(finish)) throw new Error(`Unsupported Secret Lair finish: ${offer.finish}`);
  return {
    region: normalizeSecretLairRegion(offer.region),
    finish,
    currency: clean(offer.currency).toUpperCase(),
    price: money(offer.price),
    product_url: clean(offer.product_url) || null,
    external_product_id: clean(offer.external_product_id) || null,
    sale_format: clean(offer.sale_format || 'unknown'),
    available_from: iso(offer.available_from),
    available_until: iso(offer.available_until),
    order_limit: offer.order_limit == null ? null : Number(offer.order_limit),
    distribution_channel: clean(offer.distribution_channel || 'secret_lair'),
    metadata: offer.metadata || {},
  };
}

function normalizeBundle(bundle = {}) {
  const name = clean(bundle.bundle_name || bundle.name);
  if (!name) throw new Error('Secret Lair bundle name is required');
  return {
    bundle_name: name,
    bundle_type: clean(bundle.bundle_type || 'other'),
    drops: (bundle.drops || []).map((item) => ({
      drop_name: clean(item.drop_name || item.name),
      finish: clean(item.finish).toLowerCase(),
      quantity: Number(item.quantity || 1),
    })).filter((item) => item.drop_name && SECRET_LAIR_FINISHES.includes(item.finish)),
    offers: (bundle.offers || []).map((offer) => ({
      region: normalizeSecretLairRegion(offer.region),
      currency: clean(offer.currency).toUpperCase(),
      price: money(offer.price),
      product_url: clean(offer.product_url) || null,
      external_product_id: clean(offer.external_product_id) || null,
      order_limit: offer.order_limit == null ? null : Number(offer.order_limit),
      metadata: offer.metadata || {},
    })),
  };
}

export function summarizeRegionalAvailability(observations = []) {
  const latest = new Map();
  for (const row of observations) {
    if (!row?.region || !row?.observed_at) continue;
    const key = `${row.region}|${row.offer_id || row.bundle_offer_id || row.drop_id || 'release'}`;
    const old = latest.get(key);
    if (!old || new Date(row.observed_at) > new Date(old.observed_at)) latest.set(key, row);
  }
  return SECRET_LAIR_REGIONS.map((region) => {
    const rows = [...latest.values()].filter((row) => row.region === region);
    return {
      region,
      available: rows.filter((row) => row.availability_state === 'available').length,
      low_stock: rows.filter((row) => row.availability_state === 'low_stock').length,
      sold_out: rows.filter((row) => row.availability_state === 'sold_out').length,
      unknown: rows.filter((row) => !row.availability_state || row.availability_state === 'unknown').length,
    };
  });
}
