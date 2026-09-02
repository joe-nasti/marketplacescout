import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('Secret Lair surface prefers one snapshot request and retains a fallback',async()=>{
  const source=await read('src/modules/signals/secret-lair-surface.js');
  expect(source).toContain("rest('rpc/secret_lair_signals_snapshot'");
  expect(source).toContain('return legacySnapshot()');
  expect(source).toContain('Promise.all([');
  expect(source.indexOf("rest('rpc/secret_lair_signals_snapshot'")).toBeLessThan(source.indexOf('return legacySnapshot()'));
});

test('Secret Lair snapshot RPC preserves RLS and limits execution',async()=>{
  const migration=await read('supabase/migrations/20260902060000_secret_lair_signals_snapshot.sql');
  expect(migration).toContain('security invoker');
  expect(migration).toContain('r.user_id = auth.uid()');
  expect(migration).toContain('set search_path = \'\'');
  expect(migration).toContain('revoke all on function public.secret_lair_signals_snapshot(text) from anon');
  expect(migration).toContain('grant execute on function public.secret_lair_signals_snapshot(text) to authenticated');
  expect(migration).not.toContain('security definer');
  for(const key of ['release','drops','evaluations','predictions','observations','evidence','assets','intervals','cards']){
    expect(migration).toContain(`'${key}'`);
  }
});
