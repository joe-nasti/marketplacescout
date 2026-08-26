import assert from 'node:assert/strict';
import { parseScoutSearchQuery, filterScoutPrintings, removeScoutSearchToken } from '../src/modules/scout/search-query.js';

{
  const q=parseScoutSearchQuery('Command Tower s:sld cn:2812 f:f');
  assert.equal(q.nameText,'Command Tower');
  assert.deepEqual(q.filters.setCodes,['SLD']);
  assert.deepEqual(q.filters.collectorNumbers,['2812']);
  assert.deepEqual(q.filters.finishes,['foil']);
}

{
  const q=parseScoutSearchQuery('set:CMM finish:normal foo:bar');
  assert.deepEqual(q.filters.setCodes,['CMM']);
  assert.deepEqual(q.filters.finishes,['nonfoil']);
  assert.deepEqual(q.unknownTokens,['foo:bar']);
}

{
  const q=parseScoutSearchQuery('s:SLD s:MSC f:foil f:etched');
  assert.deepEqual(q.filters.setCodes,['SLD','MSC']);
  assert.deepEqual(q.filters.finishes,['foil','etched']);
  const rows=[
    {set:'sld',collector_number:'2812',finishes:['foil']},
    {set:'sld',collector_number:'2812',finishes:['nonfoil']},
    {set:'cmm',collector_number:'350',finishes:['etched']}
  ];
  assert.equal(filterScoutPrintings(rows,q).length,1);
}

assert.equal(removeScoutSearchToken('Command Tower s:SLD f:foil','s:SLD'),'Command Tower f:foil');
console.log('scout-search-query tests passed');
