import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sourcePath=path.join(process.cwd(),'src/modules/scout/score-explain.js');

test('Scout score explanation uses promoted v5 components and removes legacy v4 UI',async()=>{
  const source=await readFile(sourcePath,'utf8');
  expect(source).toContain('thesis_points,direct_execution_points,buylist_backing_points,exit_floor_points,confirmation_points');
  expect(source).toContain("component('Thesis',thesis,70");
  expect(source).toContain("component('Execution',execution,20");
  expect(source).toContain("component('Exit / Floor',floor,5");
  expect(source).toContain("component('Confirmation',confirmation,5");
  expect(source).toContain("'Legacy v4 score'");
  expect(source).toContain('stat.remove()');
  expect(source).toContain('Why this score?');
  expect(source).toContain('Components ${fmt(sum)} → promoted Scout ${fmt(promoted)}');
});
