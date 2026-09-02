import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('saved sessions render the shell before remote validation',async()=>{
  const shell=await read('src/core/shell.js');
  const boot=shell.slice(shell.indexOf('export async function boot()'),shell.indexOf('export function startShell'));
  expect(boot.indexOf('renderShell()')).toBeGreaterThan(-1);
  expect(boot.indexOf('lifecycle.mountApp()')).toBeGreaterThan(boot.indexOf('renderShell()'));
  expect(boot.indexOf('await validSession()')).toBeGreaterThan(boot.indexOf("document.dispatchEvent(new CustomEvent('collectish:ready'"));
  expect(boot).toContain("if(!readSession()){loginView('Your session expired. Please sign in again.')");
  expect(boot).toContain("document.dispatchEvent(new CustomEvent('collectish:session-degraded'))");
});

test('startup phases are persisted for production diagnosis',async()=>{
  const main=await read('src/main.js');
  const shell=await read('src/core/shell.js');
  const health=await read('src/core/health.js');
  expect(main).toContain('window.__CollectishStartupStartedAt=performance.now()');
  expect(shell).toContain("recordStartupDuration('startup_shell_ms')");
  expect(shell).toContain("recordStartupDuration('startup_interactive_ms')");
  expect(shell).toContain("recordStartupDuration('startup_session_validation_ms',validationStarted)");
  expect(health).toContain('Startup interactive');
  expect(health).toContain('Session validation');
});
