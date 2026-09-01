import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root=process.cwd();
const styles=join(root,'src/styles');
const expected=[
  'activity-bar.css',
  'admin-alerts.css',
  'admin-catalyst-calibration.css',
  'admin-catalyst-production.css',
  'admin.css',
  'ask-history.css',
  'ask-readable.css',
  'ask-session-history.css',
  'ask.css',
  'base.css',
  'index.css',
  'mobile-quality.css',
  'mobile-touch-targets.css',
  'product-navigation.css',
  'scout-compact.css',
  'scout-detail-compact.css',
  'scout-signal-catalysts.css',
  'scout.css',
  'sealed-compact-controls.css',
  'sealed-mobile-economics.css',
  'sealed.css',
  'seller-progress.css',
  'seller.css',
  'signals-discovery.css',
  'signals-evidence.css',
  'signals-light.css',
  'signals-mobile-polish.css',
  'signals-rendered.css',
  'signals-story.css',
  'signals.css',
  'tokens.css',
  'utility-controls.css',
  'workbench-secondary.css',
  'workbench.css'
].sort();
const files=(await readdir(styles)).sort();
if(JSON.stringify(files)!==JSON.stringify(expected)){
  throw new Error(`Style tree drifted. Expected ${expected.join(', ')}, found ${files.join(', ')}`);
}
const index=await readFile(join(styles,'index.css'),'utf8');
const imports=index.match(/^@import\s+[^;]+;/gm)||[];
const expectedImports=expected.filter(file=>file!=='index.css');
if(imports.length!==expectedImports.length)throw new Error(`Expected ${expectedImports.length} style imports, found ${imports.length}`);
for(const file of expectedImports){
  if(!index.includes(`'./${file}'`)&&!index.includes(`"./${file}"`))throw new Error(`Missing canonical style import: ${file}`);
}
const tokens=await readFile(join(styles,'tokens.css'),'utf8');
for(const required of ['--color-bg-primary','--color-bg-surface','--color-text-primary','--color-accent','--font-scale-md','[data-theme="dark"]']){
  if(!tokens.includes(required))throw new Error(`Missing design token/theme contract: ${required}`);
}
const themeJs=await readFile(join(root,'src/core/theme.js'),'utf8');
if(!themeJs.includes('document.documentElement.dataset.theme=theme'))throw new Error('Theme runtime must set documentElement.dataset.theme');
for(const file of expected.filter(x=>x.endsWith('.css'))){
  const css=await readFile(join(styles,file),'utf8');
  if(css.includes('data-cx-theme'))throw new Error(`Legacy data-cx-theme selector in ${file}`);
  if(css.includes('prefers-color-scheme'))throw new Error(`Theme branching via prefers-color-scheme is forbidden in ${file}`);
}
if(/document\.documentElement\.dataset\.cxTheme\b/.test(themeJs))throw new Error('Legacy root cxTheme dataset is forbidden');
const workbench=await readFile(join(styles,'workbench.css'),'utf8');
for(const required of ['.cx-scout-layout','.cx-signals-vnext','.cx-seller-tabs','.cx-inventory-layout','.cx-mobile-nav']){
  if(!workbench.includes(required))throw new Error(`Workbench layer missing cross-screen coverage: ${required}`);
}
if(!workbench.includes('@media(max-width:700px)'))throw new Error('Workbench layer must define a mobile/Android breakpoint contract');
console.log('Collectish token/theme/workbench style system OK');
