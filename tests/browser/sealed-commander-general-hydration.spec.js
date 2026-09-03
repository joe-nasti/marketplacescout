import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('Commander hydration promotes only complete exact products and refreshes after MTGJSON identity sync', async () => {
  const sql=await fs.readFile(new URL('../../supabase/migrations/20260903010822_generalize_commander_deterministic_ev.sql',import.meta.url),'utf8');
  const workflow=await fs.readFile(new URL('../../.github/workflows/mtgjson-sync.yml',import.meta.url),'utf8');
  expect(sql).toContain('sum(dc.quantity)::integer total_cards');
  expect(sql).toContain('t.total_cards=100');
  expect(sql).toContain("p.category='deck'");
  expect(sql).toContain("lower(coalesce(p.subtype,''))='commander'");
  expect(sql).toContain("when e.child_count=0 then 'deterministic' else 'component_only'");
  expect(sql).toContain("'MTGJSON exact Commander container v2'");
  expect(sql).toContain('security invoker');
  expect(sql).toContain('mtgjson_decks_sealed_products_gin_idx');
  expect(workflow).toContain('refresh_sealed_deterministic_deck_components');
  expect(workflow.indexOf('refresh_sealed_deterministic_deck_components')).toBeGreaterThan(workflow.indexOf('mtgjson-deck-content-sync.py'));
});
