import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.join(HERE, 'supply-calibration-cohort.json');
const DEFAULT_URL = 'https://bnsnlikjeogzdubgyvxk.supabase.co';
const text = value => String(value ?? '').trim();
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;

function parseArgs(argv) {
  const args = { manifest: DEFAULT_MANIFEST, concurrency: 1, limit: Infinity, card: null, timeoutSeconds: 180, output: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = path.resolve(argv[++i]);
    else if (arg === '--concurrency') args.concurrency = Math.max(1, Math.min(4, Number(argv[++i]) || 1));
    else if (arg === '--limit') args.limit = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === '--card') args.card = text(argv[++i]);
    else if (arg === '--timeout-seconds') args.timeoutSeconds = Math.max(30, Number(argv[++i]) || 180);
    else if (arg === '--output') args.output = path.resolve(argv[++i]);
    else if (arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage: node tools/run-supply-calibration-cohort.mjs [options]\n\n` +
    `Required environment:\n  SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)\n\n` +
    `Optional environment:\n  SUPABASE_URL, SUPABASE_ACCESS_TOKEN\n\n` +
    `Options:\n  --manifest <path>     Cohort JSON manifest\n  --limit <n>           Run the first n cards\n` +
    `  --card <name>         Run one named card from the manifest\n` +
    `  --concurrency <n>     Concurrent guest-flow requests (1-4, default 1)\n` +
    `  --timeout-seconds <n> Per-card timeout (minimum 30, default 180)\n` +
    `  --output <path>       Write the complete JSON report\n` +
    `  --help                Show this help\n`;
}

async function requestJson(url, options) {
  const response = await fetch(url, { signal: AbortSignal.timeout(args.timeoutSeconds * 1000), ...options });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw }; }
  if (!response.ok) throw new Error(`${response.status} ${text(body?.error || body?.message || raw).slice(0, 400)}`);
  return body;
}

async function guestToken(url, key) {
  let body;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      body = await requestJson(`${url}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { calibration_cohort: true } }),
      });
      break;
    } catch (error) {
      if (attempt === 3 || !/^(429|5\d\d)\b/.test(String(error?.message || error))) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 3000));
    }
  }
  const token = text(body?.access_token);
  if (!token) throw new Error('Anonymous guest sign-in did not return an access token. Set SUPABASE_ACCESS_TOKEN to use an existing signed-in session.');
  return { token, userId: text(body?.user?.id) || null };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function summarize(entry, response, elapsedMs) {
  const supply = response?.market_supply || null;
  const tcg = supply?.source_depth?.tcgplayer || supply?.combined || {};
  const manaPool = supply?.source_depth?.manapool_retail || {};
  const cardKingdom = supply?.source_depth?.cardkingdom_retail || {};
  return {
    card_name: entry.card_name,
    archetype: entry.archetype,
    elapsed_ms: elapsedMs,
    resolved: response?.recovered === true,
    scope: supply?.scope || null,
    classification: supply?.classification || 'UNPROVEN',
    confidence: supply?.confidence || 'LOW',
    claim_basis: supply?.claim_basis || null,
    market_wide_thinness_proven: supply?.market_wide_thinness_proven === true,
    family_product_count: number(supply?.coverage?.product_count),
    target_sku_count: number(supply?.coverage?.target_sku_count),
    complete_sku_count: number(supply?.coverage?.complete_sku_count),
    coverage_state: supply?.coverage?.state || null,
    tcgplayer_units: number(tcg?.unit_count),
    tcgplayer_listings: number(tcg?.listing_count),
    tcgplayer_sellers: number(tcg?.unique_seller_count ?? tcg?.seller_lower_bound),
    direct_units: number(tcg?.direct_unit_count),
    non_direct_units: number(tcg?.non_direct_unit_count),
    manapool_quantity: number(manaPool?.quantity),
    manapool_coverage_ratio: number(manaPool?.coverage_ratio),
    manapool_outcome_counts: manaPool?.outcome_counts || null,
    cardkingdom_quantity: number(cardKingdom?.quantity),
    cardkingdom_mapping_pct: number(cardKingdom?.mapping_coverage_pct),
    family_discovery: supply?.family_discovery || null,
    error: supply?.error || null,
  };
}

function distribution(rows, field) {
  return Object.fromEntries([...new Set(rows.map(row => row[field] || 'MISSING'))]
    .sort().map(value => [value, rows.filter(row => (row[field] || 'MISSING') === value).length]));
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(usage()); process.exit(0); }
const url = text(process.env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, '');
const key = text(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
if (!key) throw new Error(`SUPABASE_PUBLISHABLE_KEY is required.\n\n${usage()}`);
const allCards = JSON.parse(await fs.readFile(args.manifest, 'utf8'));
const manifest = (args.card ? allCards.filter(entry => entry.card_name.toLowerCase() === args.card.toLowerCase()) : allCards).slice(0, args.limit);
if (!Array.isArray(manifest) || !manifest.length) throw new Error('The calibration manifest must contain at least one card.');
const suppliedToken = text(process.env.SUPABASE_ACCESS_TOKEN);
const guest = suppliedToken ? { token: suppliedToken, userId: null } : await guestToken(url, key);
const headers = { apikey: key, Authorization: `Bearer ${guest.token}`, 'Content-Type': 'application/json' };

const completed = [];
const raw = await mapLimit(manifest, args.concurrency, async entry => {
  const started = Date.now();
  let result;
  try {
    const response = await requestJson(`${url}/functions/v1/ask-collectish-identity-recovery`, {
      method: 'POST', headers,
      body: JSON.stringify({
        message: `Is ${entry.card_name} supply really thin? What data supports that?`,
        context: { calibration_cohort: true },
      }),
    });
    result = { entry, response, summary: summarize(entry, response, Date.now() - started) };
  } catch (error) {
    result = { entry, error: String(error?.message || error), summary: { ...summarize(entry, null, Date.now() - started), error: String(error?.message || error) } };
  }
  completed.push(result);
  console.error(`[${completed.length}/${manifest.length}] ${entry.card_name}: ${result.summary.classification} (${result.summary.coverage_state || result.summary.error || 'no evidence'})`);
  if (args.output) await fs.writeFile(`${args.output}.checkpoint`, `${JSON.stringify({ schema: 'collectish.supply.calibration-cohort.checkpoint.v1', observed_at: new Date().toISOString(), completed }, null, 2)}\n`);
  return result;
});

const rows = raw.map(result => result.summary);
const report = {
  schema: 'collectish.supply.calibration-cohort.v1',
  observed_at: new Date().toISOString(),
  scope: { language: 'ENGLISH', conditions: ['NEAR MINT', 'LIGHTLY PLAYED'], card_count: rows.length },
  guest_user_id: guest.userId,
  distributions: { classification: distribution(rows, 'classification'), confidence: distribution(rows, 'confidence'), claim_basis: distribution(rows, 'claim_basis') },
  completed_count: rows.filter(row => row.coverage_state === 'COMPLETE').length,
  error_count: rows.filter(row => row.error).length,
  rows,
  raw,
};
if (args.output) await fs.writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, raw: undefined }, null, 2));
if (guest.userId) console.error(`Temporary anonymous user created: ${guest.userId}. Delete it after the run or supply SUPABASE_ACCESS_TOKEN to avoid creating one.`);
if (report.error_count) process.exitCode = 1;
