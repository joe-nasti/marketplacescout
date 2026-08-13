import fs from 'node:fs';

const VERSION='0.7.3';
const CACHE='073';
const jsFiles=[
  'app.js','v032.js','v033.js','v035.js','v036.js','v038.js','v039.js','v042.js',
  'v044.js','v045.js','v046.js','v047.js','v048.js','v049.js','v050.js','v051.js',
  'v052.js','v054.js','v055.js','v056.js','v057.js','v058.js','v059.js','v060.js',
  'current-data.js'
];
const cssFiles=[
  'styles.css','v032.css','v038.css','v040.css','v044.css','v046.css','v048.css','v049.css',
  'v050.css','v051.css','v052.css','v053.css','v054.css','v055.css','v057.css','v058.css','v059.css','v060.css'
];

for(const f of [...jsFiles,...cssFiles,'index.html']) if(!fs.existsSync(f)) throw new Error(`Missing ${f}`);

const prelude=`// Collectish consolidated web ${VERSION}\n// Generated; do not edit directly. Run tools/build-consolidated-web.mjs.\n(()=>{\n  const realBadge=document.querySelector('#appVersion');\n  const legacyBadge=document.createElement('div');\n  legacyBadge.id='collectishLegacyVersionSink';\n  const nativeGet=Document.prototype.getElementById;\n  Document.prototype.getElementById=function(id){return id==='appVersion'?legacyBadge:nativeGet.call(this,id)};\n  const NativeMO=window.MutationObserver;\n  window.MutationObserver=class extends NativeMO{observe(target,opts){if(target===legacyBadge)return;return super.observe(target,opts)}};\n  const isLegacyAsset=node=>{\n    if(!node||node.nodeType!==1)return false;\n    const raw=node.tagName==='SCRIPT'?node.getAttribute('src'):node.tagName==='LINK'?node.getAttribute('href'):'';\n    if(!raw)return false;\n    try{const u=new URL(raw,location.href);return /^v\\d+\\.(?:js|css)$/i.test(u.pathname.split('/').pop()||'')}catch{return false}\n  };\n  const appendChild=Node.prototype.appendChild;Node.prototype.appendChild=function(n){return isLegacyAsset(n)?n:appendChild.call(this,n)};\n  const append=Element.prototype.append;Element.prototype.append=function(...n){return append.apply(this,n.filter(x=>!isLegacyAsset(x)))};\n  const prepend=Element.prototype.prepend;Element.prototype.prepend=function(...n){return prepend.apply(this,n.filter(x=>!isLegacyAsset(x)))};\n  const adjacent=Element.prototype.insertAdjacentElement;Element.prototype.insertAdjacentElement=function(p,n){return isLegacyAsset(n)?n:adjacent.call(this,p,n)};\n  if(realBadge)realBadge.textContent='web ${VERSION}';\n  window.__collectishConsolidated={version:'${VERSION}',builtAt:'${new Date().toISOString()}'};\n})();\n`;

const finale=`\n// Consolidated startup finalizer\n(()=>{\n  const b=document.querySelector('#appVersion');if(b)b.textContent='web ${VERSION}';\n  let s=null;try{s=JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{}\n  if(!s?.token){\n    const banner=document.querySelector('#activityBanner');if(banner){banner.hidden=true;banner.style.display='none'}\n    const scout=document.querySelector('#mobileScoutLoading');if(scout){scout.hidden=true;scout.style.display='none'}\n  }\n})();\n`;

const js=prelude+jsFiles.map(f=>`\n/* ===== ${f} ===== */\n${fs.readFileSync(f,'utf8')}\n`).join('')+finale;
const css=cssFiles.map(f=>`/* ===== ${f} ===== */\n${fs.readFileSync(f,'utf8')}\n`).join('\n');
fs.writeFileSync('collectish-app.js',js);
fs.writeFileSync('collectish-app.css',css);

let html=fs.readFileSync('index.html','utf8');
html=html.replace(/<div id="appVersion" class="version-badge">.*?<\/div>/,'<div id="appVersion" class="version-badge">web '+VERSION+'</div>');
html=html.replace(/<link rel="stylesheet" href="collectish-app\.css\?v=\d+">/,'<link rel="stylesheet" href="collectish-app.css?v='+CACHE+'">');
html=html.replace(/<script src="config\.js\?v=\d+"><\/script><script src="collectish-app\.js\?v=\d+"><\/script>/,'<script src="config.js?v='+CACHE+'"></script><script src="collectish-app.js?v='+CACHE+'"></script>');
fs.writeFileSync('index.html',html);

console.log(`Built Collectish web ${VERSION}: ${js.length} JS bytes, ${css.length} CSS bytes`);
