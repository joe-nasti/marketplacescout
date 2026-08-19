// One-time migration: consolidate the active CSS cascade into semantic token/domain files.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root=process.cwd();
const styles=join(root,'src/styles');
const read=async p=>readFile(join(styles,p),'utf8');

const groups={
  'base.css':['base/core.css','base/layout.css','base/mobile.css','base/build-badge.css'],
  'scout.css':['modules/scout.css','modules/scout-links.css'],
  'sealed.css':['modules/sealed-ev.css','modules/sealed-images.css','modules/sealed-card.css','modules/sealed-metrics.css','modules/sealed-tooltips.css','modules/sealed-component-economics.css','modules/sealed-component-table.css','modules/sealed-component-best.css','modules/sealed-detail-zoom.css','modules/sealed-source-anchors.css','modules/sealed-summary-actions.css','modules/sealed-summary-tcg.css','modules/sealed-freshness.css','modules/sealed-language-confidence.css','modules/sealed-language-filter.css'],
  'seller.css':['modules/seller.css','modules/syp.css'],
  'ask.css':['modules/ask.css','modules/ask-v2.css','modules/ask-v3.css','modules/ask-markdown.css','modules/ask-investigate.css','modules/ask-concise.css'],
  'admin.css':['modules/admin.css']
};

const tokens=`/* Collectish semantic design tokens. Component CSS consumes these tokens (legacy --cx-* aliases are temporary compatibility names). */
:root,[data-theme="light"]{
  color-scheme:light;
  --color-bg-primary:#f5f8ff;--color-bg-surface:#ffffff;--color-bg-elevated:#ffffff;--color-bg-input:#ffffff;
  --color-text-primary:#0b1538;--color-text-secondary:#64718b;--color-border:#d9e3f1;
  --color-accent:#1866e8;--color-accent-bright:#2f8cfa;--color-accent-soft:#eaf2ff;
  --color-success:#128a4b;--color-danger:#d92d20;--color-warning:#d97706;--color-overlay:rgba(11,21,56,.42);
  --shadow-card:0 8px 28px rgba(11,21,56,.07);--shadow-float:0 12px 36px rgba(11,21,56,.14);
  --radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-xl:22px;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;
  --font-scale-xs:.75rem;--font-scale-sm:.8125rem;--font-scale-md:.9375rem;--font-scale-lg:1.125rem;--font-scale-xl:1.5rem;--font-scale-2xl:1.75rem;
  --cx-bg:var(--color-bg-primary);--cx-card:var(--color-bg-surface);--cx-text:var(--color-text-primary);--cx-muted:var(--color-text-secondary);--cx-line:var(--color-border);--cx-blue:var(--color-accent);--cx-blue-soft:var(--color-accent-soft);--cx-accent:var(--color-accent);--cx-green:var(--color-success);--cx-red:var(--color-danger);--cx-amber:var(--color-warning);--cx-shadow:var(--shadow-card);
}
[data-theme="dark"]{
  color-scheme:dark;
  --color-bg-primary:#0b1538;--color-bg-surface:#101f42;--color-bg-elevated:#14264d;--color-bg-input:#0d1a38;
  --color-text-primary:#ffffff;--color-text-secondary:#a9bed4;--color-border:#29416f;
  --color-accent:#2f8cfa;--color-accent-bright:#87b8ff;--color-accent-soft:#102e66;
  --color-success:#5bd79a;--color-danger:#ff837a;--color-warning:#ffc566;--color-overlay:rgba(0,0,0,.55);
  --shadow-card:0 12px 36px rgba(0,0,0,.34);--shadow-float:0 16px 44px rgba(0,0,0,.46);
}
`;

function normalizeBase(css){
  return css
    .replace(/:root\{--cx-bg:[^}]+\}\s*/,'')
    .replaceAll(':root[data-cx-theme="light"]','[data-theme="light"]')
    .replaceAll(':root[data-cx-theme="dark"]','[data-theme="dark"]')
    .replaceAll('[data-cx-theme="light"]','[data-theme="light"]')
    .replaceAll('[data-cx-theme="dark"]','[data-theme="dark"]');
}

for(const [out,inputs] of Object.entries(groups)){
  const parts=[];
  for(const input of inputs){
    try{parts.push(`/* source: ${input} */\n${await read(input)}`)}catch(e){throw new Error(`Missing active CSS fragment ${input}: ${e.message}`)}
  }
  await writeFile(join(styles,out),parts.join('\n\n')+'\n');
}

let theme=await read('theme.css');
theme=theme
  .replace(/:root\[data-cx-theme="light"\]\{[^}]*\}\s*/s,'')
  .replace(/:root\[data-cx-theme="dark"\]\{[^}]*\}\s*/s,'')
  .replaceAll(':root[data-cx-theme="light"]','[data-theme="light"]')
  .replaceAll(':root[data-cx-theme="dark"]','[data-theme="dark"]')
  .replaceAll('[data-cx-theme="light"]','[data-theme="light"]')
  .replaceAll('[data-cx-theme="dark"]','[data-theme="dark"]');
const basePath=join(styles,'base.css');
await writeFile(basePath,normalizeBase(await readFile(basePath,'utf8'))+'\n/* shared themed component rules */\n'+theme+'\n');
await writeFile(join(styles,'tokens.css'),tokens);
await writeFile(join(styles,'index.css'),[
  "@import './tokens.css';",
  "@import './base.css';",
  "@import './scout.css';",
  "@import './sealed.css';",
  "@import './seller.css';",
  "@import './ask.css';",
  "@import './admin.css';",
  ''
].join('\n'));
await rm(join(styles,'base'),{recursive:true,force:true});
await rm(join(styles,'modules'),{recursive:true,force:true});
await rm(join(styles,'theme.css'),{force:true});
console.log('Consolidated Collectish CSS into semantic tokens + six domain files.');
