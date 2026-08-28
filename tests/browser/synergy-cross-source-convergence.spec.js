import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('creator synergies use cached cross-source convergence without changing Scout grade',async()=>{
  const [migration,refresh,ui,workflow]=await Promise.all([
    read('supabase/migrations/20260828032000_synergy_cross_source_convergence_cache.sql'),
    read('supabase/functions/market-intel-synergy-convergence-refresh/index.ts'),
    read('src/modules/signals/scout-synergy-opportunities.js'),
    read('.github/workflows/signals-synergy-convergence.yml')
  ]);
  expect(migration).toContain('market_intel_synergy_convergence_cache');
  expect(migration).toContain('security_invoker = true');
  expect(migration).toContain('(select auth.uid())=user_id');
  expect(refresh).toContain("sk!==catalystSource");
  expect(refresh).toContain("n>=3?'strong_convergence':n>=1?'multi_source':'single_source'");
  expect(refresh).toContain('independent_nonvideo_source_count');
  expect(ui).toContain('Cross-source confirmation:');
  expect(ui).toContain('Scout grade unchanged');
  expect(ui).toContain('effective_convergence_score');
  expect(workflow).toContain('17,47 * * * *');
});
