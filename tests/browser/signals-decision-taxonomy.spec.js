import {test,expect} from '@playwright/test';

const load=()=>import('../../src/modules/signals/scan-view.js');

test('Signals decision taxonomy distinguishes Action Emerging Confirming and Watch',async()=>{
  const {buildSignalScanRows}=await load();
  const rows=buildSignalScanRows({
    actionableRows:[
      {sku_id:'a1',card_name:'Action Card',action_class:'action_now',actionability_score:95,signal_families:3},
      {sku_id:'e1',card_name:'Emerging Card',action_class:'emerging_quick_turn',actionability_score:80,signal_families:2}
    ],
    intelItems:[
      {intel_id:'i1',signal_stage:'confirming',title:'Confirming source',market_intel_entities:[{entity_type:'card',product_id:'p1',entity_name:'Confirming Card'}]},
      {intel_id:'i2',signal_stage:'neutral',title:'Monitor source',market_intel_entities:[{entity_type:'card',product_id:'p2',entity_name:'Watch Card'}]}
    ]
  });
  expect(rows.map(r=>[r.card_name,r.kind,r.signal])).toEqual([
    ['Action Card','action','Action now'],
    ['Emerging Card','emerging','Emerging'],
    ['Confirming Card','confirming','Confirming'],
    ['Watch Card','watch','Watch']
  ]);
});

test('Signals scan KPIs and filters use the same four decision stages',async()=>{
  const {renderSignalScan}=await load();
  const html=renderSignalScan({
    actionableRows:[
      {sku_id:'a1',card_name:'Action Card',action_class:'action_now',actionability_score:95},
      {sku_id:'e1',card_name:'Emerging Card',action_class:'emerging_quick_turn',actionability_score:80}
    ],
    intelItems:[
      {intel_id:'i1',signal_stage:'confirming',market_intel_entities:[{entity_type:'card',product_id:'p1',entity_name:'Confirming Card'}]},
      {intel_id:'i2',signal_stage:'neutral',market_intel_entities:[{entity_type:'card',product_id:'p2',entity_name:'Watch Card'}]}
    ]
  });
  expect(html).toContain('Action now');
  expect(html).toContain('Emerging');
  expect(html).toContain('Confirming');
  expect(html).toContain('Watch');
  expect(html).toContain('data-sv-filter="confirming"');
  expect(html).not.toContain('verified cards');
  expect(html).not.toContain('>Sources<');
  expect(html).toContain('<small>Evidence</small>');
  expect(html).toContain('<small>Confidence</small>');
});

test('external leading and confirming intelligence never collapses into Watch',async()=>{
  const {buildSignalScanRows}=await load();
  const rows=buildSignalScanRows({intelItems:[
    {signal_stage:'leading',market_intel_entities:[{entity_type:'card',product_id:'p1',entity_name:'Leading Card'}]},
    {signal_stage:'confirming',market_intel_entities:[{entity_type:'card',product_id:'p2',entity_name:'Confirming Card'}]}
  ]});
  const byName=Object.fromEntries(rows.map(r=>[r.card_name,r.kind]));
  expect(byName['Leading Card']).toBe('emerging');
  expect(byName['Confirming Card']).toBe('confirming');
});
