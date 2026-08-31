import { recommendationFromExpertRating } from './secret-lair-score.js';

const clean = (value) => String(value ?? '').trim();
const clamp100 = (value) => Math.max(0, Math.min(100, Number(value) || 0));

export const EXPERT_REVIEW_DIMENSIONS = Object.freeze([
  'card_quality', 'anchor_strength', 'playable_depth', 'staple_breadth', 'obscurity',
  'art', 'treatment', 'version_of_choice', 'premium_competition', 'ip_heat', 'ip_fit',
  'cute_meme_nostalgia', 'supply', 'sale_mechanics', 'distribution', 'wait_aversion',
  'promo', 'bundle', 'merchandise', 'value', 'liquidity', 'reprint_risk', 'sell_through', 'other',
]);

export function normalizeExpertReview(input = {}) {
  const rating = Number(input.rating ?? input.raw_rating);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) throw new Error('Expert review rating must be 0-10');
  const dropName = clean(input.drop_name || input.drop);
  if (!dropName) throw new Error('Expert review drop name is required');

  return {
    release_name: clean(input.release_name || input.release) || null,
    drop_name: dropName,
    reviewer: clean(input.reviewer || 'Expert Review'),
    source_url: clean(input.source_url) || null,
    published_at: input.published_at || null,
    raw_rating: rating,
    raw_rating_scale: 10,
    normalized_score: clamp100(rating * 10),
    recommendation: recommendationFromExpertRating(rating),
    summary: clean(input.summary || input.review_text || input.text),
    assertions: (input.assertions || []).map(normalizeAssertion),
    metadata: input.metadata || {},
  };
}

export function normalizeAssertion(assertion = {}) {
  const dimension = clean(assertion.dimension || assertion.claim_dimension || 'other');
  if (!EXPERT_REVIEW_DIMENSIONS.includes(dimension)) throw new Error(`Unsupported expert review dimension: ${dimension}`);
  const direction = clean(assertion.direction || 'neutral').toLowerCase();
  if (!['bullish', 'bearish', 'neutral'].includes(direction)) throw new Error(`Unsupported assertion direction: ${direction}`);
  return {
    claim_dimension: dimension,
    direction,
    confidence: Math.max(0, Math.min(1, Number(assertion.confidence ?? 0.8))),
    normalized_score: assertion.normalized_score == null ? null : clamp100(assertion.normalized_score),
    summary: clean(assertion.summary),
    metadata: assertion.metadata || {},
  };
}

export function expertReviewToEvidenceRows(review, ids = {}) {
  const normalized = normalizeExpertReview(review);
  const base = {
    release_id: ids.release_id || null,
    drop_id: ids.drop_id || null,
    source_type: 'expert_review',
    source_name: normalized.reviewer,
    source_url: normalized.source_url,
    author: normalized.reviewer,
    published_at: normalized.published_at,
    evidence_class: 'expert_opinion',
    raw_rating: normalized.raw_rating,
    raw_rating_scale: normalized.raw_rating_scale,
  };
  const assertions = normalized.assertions.length ? normalized.assertions : [{
    claim_dimension: 'other',
    direction: normalized.raw_rating >= 7 ? 'bullish' : normalized.raw_rating <= 4 ? 'bearish' : 'neutral',
    confidence: 0.75,
    normalized_score: normalized.normalized_score,
    summary: normalized.summary || `${normalized.drop_name}: ${normalized.raw_rating}/10`,
    metadata: {},
  }];
  return assertions.map((assertion) => ({
    ...base,
    ...assertion,
    metadata: {
      ...normalized.metadata,
      ...assertion.metadata,
      release_name: normalized.release_name,
      drop_name: normalized.drop_name,
      recommendation: normalized.recommendation,
      full_review: normalized.summary || null,
    },
  }));
}
