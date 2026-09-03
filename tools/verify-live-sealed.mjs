import { chromium, devices } from '@playwright/test';
import fs from 'node:fs/promises';

const target = process.env.COLLECTISH_PRODUCTION_URL || 'https://joe-nasti.github.io/marketplacescout/';
const email = process.env.COLLECTISH_E2E_EMAIL;
const password = process.env.COLLECTISH_E2E_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL || 'https://bnsnlikjeogzdubgyvxk.supabase.co';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Zl0XS3ueisENWcQAmQ0mwA_FIC4yje2';
const outDir = 'test-results/live-sealed-production';

if (!email || !password) {
  throw new Error('COLLECTISH_E2E_EMAIL and COLLECTISH_E2E_PASSWORD are required. Use a dedicated read-only Collectish E2E account; never a personal password.');
}

await fs.mkdir(outDir, { recursive: true });

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function dollars(value) {
  return /^-?\$[\d,]+(?:\.\d{2})?$/.test(String(value || '').trim());
}

async function readRevision(page) {
  return {
    build: await page.locator('meta[name="collectish-build"]').getAttribute('content').catch(() => null),
    revision: await page.locator('meta[name="collectish-revision"]').getAttribute('content').catch(() => null),
  };
}

async function waitForStableRevision(page) {
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    const sample = { ...(await readRevision(page)), at: new Date().toISOString() };
    samples.push(sample);
    const recent = samples.slice(-3);
    if (recent.length === 3 && recent.every(x => x.build && x.revision && x.build === recent[0].build && x.revision === recent[0].revision)) {
      return { ...recent[0], samples };
    }
    await page.waitForTimeout(750);
  }
  throw new Error(`Production revision did not stabilize: ${JSON.stringify(samples)}`);
}

async function exactGiftBundle(page) {
  const locator = page.locator('button[data-deck]').filter({ has: page.getByText('The Hobbit Gift Bundle', { exact: true }) });
  const count = await locator.count();
  if (count !== 1) throw new Error(`Expected exactly one The Hobbit Gift Bundle row, found ${count}`);
  return locator.first();
}

async function waitForPopulatedListRow(page, gift) {
  const id = await gift.getAttribute('data-deck');
  if (!id) throw new Error('Gift Bundle row is missing data-deck');
  await page.waitForFunction(sealedId => {
    const row = [...document.querySelectorAll('button[data-deck]')].find(node => node.getAttribute('data-deck') === sealedId);
    if (!row) return false;
    const text = row.innerText || '';
    const moneyValues = text.match(/-?\$[\d,]+(?:\.\d{2})?/g) || [];
    return !/MODEL PENDING/i.test(text) && moneyValues.length >= 2;
  }, id, { timeout: 45_000 });
}

async function detailMetrics(page) {
  return page.locator('.cx-sealed-grid .cx-sealed-stat').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const label = node.querySelector('span')?.textContent?.trim() || '';
    const value = node.querySelector('strong')?.textContent?.trim() || '';
    const sub = node.querySelector('small')?.textContent?.trim() || '';
    return [label, { value, sub }];
  }).filter(([label]) => label)));
}

function findMetric(metrics, pattern) {
  const entry = Object.entries(metrics).find(([label]) => pattern.test(label));
  return entry ? { label: entry[0], ...entry[1] } : null;
}

async function desktopLayoutEvidence(page) {
  return page.evaluate(() => {
    const detail = document.querySelector('#cxSealedDetail');
    const detailBox = detail?.getBoundingClientRect();
    const rows = [...document.querySelectorAll('#cxSealedRows button[data-deck]')].filter(node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    }).slice(0, 12);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      productGroups: [...document.querySelectorAll('.cx-sealed-product-groups')].map(node => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })),
      detail: detailBox ? { left: detailBox.left, right: detailBox.right, width: detailBox.width } : null,
      rows: rows.map(node => {
        const box = node.getBoundingClientRect();
        return {
          name: node.querySelector('strong')?.textContent?.trim() || '',
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          overflowX: Math.max(0, node.scrollWidth - node.clientWidth),
          contentRight: box.left + node.scrollWidth,
          intrudesDetail: Boolean(detailBox && box.bottom > detailBox.top && box.top < detailBox.bottom && box.left + node.scrollWidth > detailBox.left + 1),
        };
      }),
    };
  });
}

const session = await jsonRequest(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!session?.access_token || !session?.refresh_token) throw new Error('Dedicated E2E account authentication returned no usable session');

const profiles = {
  desktop: { viewport: { width: 1440, height: 1000 } },
  pixel10: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } },
};
const results = [];
let failures = 0;
let pinnedRevision = null;
let pinnedBuild = null;

for (const [profile, options] of Object.entries(profiles)) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(options);
  await context.addInitScript(({ authSession, userEmail }) => {
    localStorage.setItem('collectishSession', JSON.stringify({
      token: authSession.access_token,
      refresh: authSession.refresh_token,
      exp: Date.now() + Number(authSession.expires_in || 1800) * 1000,
      user: authSession.user || { email: userEmail },
    }));
  }, { authSession: session, userEmail: email });

  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const errorResponses = [];
  const stepTimingsMs = {};
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push({ method: request.method(), url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', response => {
    if (response.status() >= 400) errorResponses.push({ method: response.request().method(), url: response.url(), status: response.status() });
  });

  const result = {
    profile,
    target,
    capturedAt: new Date().toISOString(),
    account: { dedicatedE2E: true, emailRedacted: String(email).replace(/(^.).*(@.*$)/, '$1***$2') },
    checks: {},
    consoleErrors,
    failedRequests,
    errorResponses,
    stepTimingsMs,
    screenshots: [],
  };

  const timed = async (name, fn) => {
    const start = Date.now();
    try { return await fn(); } finally { stepTimingsMs[name] = Date.now() - start; }
  };
  const screenshot = async name => {
    const path = `${outDir}/${profile}-${name}.png`;
    await page.screenshot({ path, fullPage: true });
    result.screenshots.push(path);
  };

  try {
    await timed('initialLoad', () => page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 }));
    await page.getByRole('button', { name: 'Sealed', exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
    const stable = await waitForStableRevision(page);
    result.revisionStart = stable;
    if (!pinnedRevision) {
      pinnedRevision = stable.revision;
      pinnedBuild = stable.build;
    } else if (stable.revision !== pinnedRevision || stable.build !== pinnedBuild) {
      throw new Error(`Production changed between viewport captures: expected ${pinnedBuild}/${pinnedRevision}, got ${stable.build}/${stable.revision}`);
    }

    await timed('openSealed', () => page.getByRole('button', { name: 'Sealed', exact: true }).click());
    await page.getByRole('heading', { name: 'Scout Sealed' }).waitFor({ state: 'visible', timeout: 60_000 });
    result.checks.scoutSealedLoaded = true;
    await screenshot('sets');

    const hobbitSet = page.getByRole('button', { name: /The Hobbit HOB/ }).first();
    await hobbitSet.waitFor({ state: 'visible', timeout: 60_000 });
    result.hobbitSetRow = (await hobbitSet.innerText()).trim();
    await timed('setToProducts', () => hobbitSet.click());

    let gift = await exactGiftBundle(page);
    await gift.waitFor({ state: 'visible', timeout: 30_000 });
    await timed('listEconomicsPopulate', () => waitForPopulatedListRow(page, gift));
    gift = await exactGiftBundle(page);
    result.listRow = (await gift.innerText()).trim();
    result.checks.exactGiftBundle = /^The Hobbit Gift Bundle(?:\n|$)/.test(result.listRow) && !/^The Hobbit Gift Bundle Case(?:\n|$)/.test(result.listRow);
    result.checks.listEconomicsPopulated = !/MODEL PENDING/i.test(result.listRow) && (result.listRow.match(/-?\$[\d,]+(?:\.\d{2})?/g) || []).length >= 2;
    result.layout = await desktopLayoutEvidence(page);
    if (profile === 'desktop') {
      result.checks.desktopRowsDoNotOverflow = result.layout.rows.every(row => row.overflowX <= 2 && !row.intrudesDetail) && result.layout.productGroups.every(group => group.scrollWidth <= group.clientWidth + 2);
    }
    await screenshot('hobbit-products');

    await timed('openGiftDetail', () => gift.click());
    await page.getByText('Gross reference EV', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => !/Model pending/i.test(document.querySelector('#cxSealedDetail')?.innerText || ''), null, { timeout: 45_000 });

    result.detailMetrics = await detailMetrics(page);
    result.detailGrid = (await page.locator('.cx-sealed-grid').innerText()).trim();
    result.provenance = (await page.locator('.cx-sealed-provenance').innerText()).trim();
    result.components = (await page.locator('.cx-sealed-component-summary').innerText()).trim();

    const gross = findMetric(result.detailMetrics, /Gross reference EV/i);
    const tcgLow = findMetric(result.detailMetrics, /TCG Low(?:-based)? EV/i);
    const direct = findMetric(result.detailMetrics, /Direct-first net EV/i);
    const liveOut = findMetric(result.detailMetrics, /Collectish live-out EV/i);
    result.checks.grossReferencePopulated = Boolean(gross && dollars(gross.value));
    result.checks.tcgLowPopulated = Boolean(tcgLow && dollars(tcgLow.value));
    result.checks.directFirstPopulated = Boolean(direct && dollars(direct.value));
    result.checks.collectishLiveOutPopulated = Boolean(liveOut && dollars(liveOut.value));
    result.checks.playBoosters = /\b9\b[\s\S]*The Hobbit Play Booster Pack/i.test(result.components);
    result.checks.collectorBooster = /\b1\b[\s\S]*The Hobbit Collector Booster Pack/i.test(result.components);
    result.checks.provenanceCoverage = /coverage/i.test(result.provenance);
    result.checks.provenanceFallback = /fallback/i.test(result.provenance);
    result.checks.provenanceModel = /model/i.test(result.provenance);
    result.checks.provenanceDate = /valued|valuation|date/i.test(result.provenance);
    await screenshot('gift-detail');

    await timed('browserBack', () => page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }));
    await page.getByRole('heading', { name: 'Scout Sealed' }).waitFor({ state: 'visible', timeout: 30_000 });
    gift = await exactGiftBundle(page);
    await gift.waitFor({ state: 'visible', timeout: 30_000 });
    result.checks.backStackRestored = true;
    result.backRestoredRow = (await gift.innerText()).trim();
    await screenshot('back-restored');

    result.navigationTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return nav ? {
        type: nav.type,
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadEventMs: Math.round(nav.loadEventEnd),
        transferSize: nav.transferSize,
      } : null;
    });

    const revisionEnd = await waitForStableRevision(page);
    result.revisionEnd = revisionEnd;
    result.checks.revisionStable = revisionEnd.revision === stable.revision && revisionEnd.build === stable.build;
    result.relevantErrorResponses = errorResponses.filter(item => item.status >= 500 || ([401, 403].includes(item.status) && (item.url.startsWith(supabaseUrl) || item.url.startsWith(target))));
    result.checks.noProtectedOrServerErrors = result.relevantErrorResponses.length === 0;

    const failedChecks = Object.entries(result.checks).filter(([, value]) => value === false).map(([key]) => key);
    if (failedChecks.length) throw new Error(`Failed checks: ${failedChecks.join(', ')}`);
    result.status = 'passed';
  } catch (error) {
    failures += 1;
    result.status = 'failed';
    result.error = String(error?.stack || error);
    result.revisionEnd = await readRevision(page).catch(() => null);
    await screenshot('failure').catch(() => {});
  } finally {
    results.push(result);
    await fs.writeFile(`${outDir}/${profile}.json`, JSON.stringify(result, null, 2));
    await browser.close();
  }
}

const summary = {
  target,
  capturedAt: new Date().toISOString(),
  pinnedBuild,
  pinnedRevision,
  status: failures ? 'failed' : 'passed',
  profiles: results.map(({ profile, status, revisionStart, revisionEnd, checks, error, screenshots }) => ({ profile, status, revisionStart, revisionEnd, checks, error, screenshots })),
};
await fs.writeFile(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (failures) process.exitCode = 1;
