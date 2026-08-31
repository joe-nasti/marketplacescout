import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../supabase/functions/secret-lair-market-sync/index.ts', import.meta.url), 'utf8');
const match = source.match(/export function finishOf\(name:any\)\{([^}]+)\}/);
assert.ok(match, 'secret-lair-market-sync must export finishOf');

function finishOf(name) {
  const s = String(name || '');
  if (/non[-\s]?foil/i.test(s)) return 'nonfoil';
  if (/traditional\s+foil|foil\s+edition/i.test(s)) return 'foil';
  return 'unknown';
}

test('Non-Foil Edition is never classified as foil', () => {
  assert.equal(finishOf('Secret Lair Drop: Example - Non-Foil Edition'), 'nonfoil');
});

test('Traditional Foil Edition is foil', () => {
  assert.equal(finishOf('Secret Lair Drop: Example - Traditional Foil Edition'), 'foil');
});

test('unknown names are not auto-assigned a finish', () => {
  assert.equal(finishOf('Secret Lair Drop: Example'), 'unknown');
});

test('production source checks nonfoil before generic foil', () => {
  const nonfoilAt = match[1].indexOf('non[-\\s]?foil');
  const foilAt = match[1].indexOf('traditional\\s+foil');
  assert.ok(nonfoilAt >= 0 && foilAt > nonfoilAt, 'Non-Foil guard must execute before foil matching');
});
