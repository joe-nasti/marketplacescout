import {test,expect} from '@playwright/test';
import {scoreCatalystShadow,uniqueSignals} from '../../src/modules/signals/catalyst-shadow-score.js';

const now=new Date('2026-08-27T18:00:00Z').getTime();
const base={sku_id:'1',product_name:'Example Card',promoted_score:78,promoted_grade:'B'};
const signal=(overrides={})=>({intel_id:Math.random(),source_type:'youtube',source_name:'Creator A',source_url:'https://youtube.com/watch?v=abc',signal_stage:'confirming',direction:'bullish',confidence:.9,observed_at:'2026-08-26T18:00:00Z',...overrides});

test('catalyst shadow is bounded and leaves official score untouched',()=>{
  const signals=Array.from({length:20},(_,i)=>signal({source_name:`Creator ${i}`,source_url:`https://example${i}.com/post`,signal_stage:'confirming'}));
  const out=scoreCatalystShadow({row:base,signals,now});
  expect(out.baseScore).toBe(78);
  expect(out.modifier).toBeLessThanOrEqual(12);
  expect(out.appliedModifier).toBeLessThanOrEqual(12);
  expect(out.shadowScore).toBe(90);
  expect(base.promoted_score).toBe(78);
});

test('duplicate source events are counted once',()=>{
  const a=signal(),b=signal({intel_id:'second',summary:'Repeated commentary from same source'});
  expect(uniqueSignals([a,b])).toHaveLength(1);
  const out=scoreCatalystShadow({row:base,signals:[a,b],now});
  expect(out.signalCount).toBe(1);
  expect(out.sourceCount).toBe(1);
});

test('independent recent confirmation outweighs stale repetition',()=>{
  const recent=[signal({source_name:'Creator A',source_url:'https://a.example/post'}),signal({source_name:'Creator B',source_url:'https://b.example/post'})];
  const stale=[signal({source_name:'Creator A',source_url:'https://a.example/old',observed_at:'2026-04-01T00:00:00Z'}),signal({source_name:'Creator B',source_url:'https://b.example/old',observed_at:'2026-04-01T00:00:00Z'})];
  const a=scoreCatalystShadow({row:base,signals:recent,now});
  const b=scoreCatalystShadow({row:base,signals:stale,now});
  expect(a.modifier).toBeGreaterThan(b.modifier);
  expect(a.sourceCount).toBe(2);
});

test('bearish catalysts can lower the shadow score',()=>{
  const signals=[signal({direction:'bearish',source_name:'A',source_url:'https://a.example/post'}),signal({direction:'bearish',source_name:'B',source_url:'https://b.example/post'})];
  const out=scoreCatalystShadow({row:base,signals,now});
  expect(out.appliedModifier).toBeLessThan(0);
  expect(out.shadowScore).toBeLessThan(out.baseScore);
});

test('future release stores thesis modifier but applies zero to live Scout',()=>{
  const row={...base,release_date:'2026-09-20'};
  const out=scoreCatalystShadow({row,signals:[signal()],now});
  expect(out.future).toBe(true);
  expect(out.modifier).toBeGreaterThan(0);
  expect(out.appliedModifier).toBe(0);
  expect(out.shadowScore).toBe(out.baseScore);
  expect(out.reasons[0]).toContain('Future release');
});

test('cross-source corroboration contributes within the same cap',()=>{
  const out=scoreCatalystShadow({row:base,signals:[signal()],crossSource:[{evidence_sources:4}],now});
  expect(out.modifier).toBeGreaterThan(0);
  expect(out.modifier).toBeLessThanOrEqual(12);
  expect(out.reasons.some(x=>x.includes('evidence families'))).toBe(true);
});
