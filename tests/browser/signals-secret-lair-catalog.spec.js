import { test, expect } from '@playwright/test';
import { normalizeSecretLairCatalog, summarizeRegionalAvailability } from '../../src/modules/signals/secret-lair-catalog.js';
import { normalizeExpertReview, expertReviewToEvidenceRows } from '../../src/modules/signals/secret-lair-expert-review.js';

test('normalizes US REU UK storefront offers without splitting global product identity', async () => {
  const catalog = normalizeSecretLairCatalog({
    release_name: 'Test Superdrop',
    sale_format: 'fixed_quantity',
    supply_notes: 'Global print quantity unknown',
    regions: [
      { region: 'US', currency: 'USD' },
      { region: 'REU', currency: 'EUR' },
      { region: 'UK', currency: 'GBP' },
    ],
    drops: [{
      name: 'Test Drop',
      cards: [{ name: 'Sol Ring' }],
      offers: [
        { region: 'US', finish: 'foil', currency: 'USD', price: 39.99 },
        { region: 'REU', finish: 'foil', currency: 'EUR', price: 44.99 },
        { region: 'UK', finish: 'foil', currency: 'GBP', price: 39.99 },
      ],
    }],
  });
  expect(catalog.release_name).toBe('Test Superdrop');
  expect(catalog.regions.map(x => x.region)).toEqual(['US','REU','UK']);
  expect(catalog.drops).toHaveLength(1);
  expect(catalog.drops[0].offers.map(x => x.region)).toEqual(['US','REU','UK']);
});

test('summarizes regional availability independently', async () => {
  const rows = summarizeRegionalAvailability([
    { region:'US', drop_id:'a', availability_state:'sold_out', observed_at:'2026-08-31T17:15:00Z' },
    { region:'REU', drop_id:'a', availability_state:'available', observed_at:'2026-08-31T17:15:00Z' },
    { region:'UK', drop_id:'a', availability_state:'available', observed_at:'2026-08-31T17:15:00Z' },
  ]);
  expect(rows.find(x => x.region === 'US').sold_out).toBe(1);
  expect(rows.find(x => x.region === 'REU').available).toBe(1);
  expect(rows.find(x => x.region === 'UK').available).toBe(1);
});

test('preserves expert rating and attributed assertions', async () => {
  const review = normalizeExpertReview({
    release_name:'Cats Are the Best Superdrop',
    drop_name:"Witch's Familiar",
    reviewer:'Expert Review',
    rating:10,
    review_text:'Value is there, art is crazy good.',
    assertions:[
      { dimension:'art', direction:'bullish', confidence:.9, summary:'Art is unusually strong.' },
      { dimension:'version_of_choice', direction:'bullish', confidence:.85, summary:'Clean premium staple treatment.' },
    ],
  });
  expect(review.recommendation).toBe('pot_of_gold');
  const rows = expertReviewToEvidenceRows(review, { release_id:'r', drop_id:'d' });
  expect(rows).toHaveLength(2);
  expect(rows[0].source_type).toBe('expert_review');
  expect(rows[0].raw_rating).toBe(10);
});
