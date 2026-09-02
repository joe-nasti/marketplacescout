import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('primary Signals entity embedding has a parent lookup index',async()=>{
  const sql=await readFile('supabase/migrations/20260902192000_index_market_intel_entities_parent_lookup.sql','utf8');
  expect(sql).toMatch(/market_intel_entities_intel_user_idx/i);
  expect(sql).toMatch(/market_intel_entities\s*\(intel_id,\s*user_id\)/i);
});
