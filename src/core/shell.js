import { collectishConfig } from './config.js';
import { readSession, saveSession, validSession, signIn } from './session.js';
import { readUrlState, writeUrlState, onUrlStateChange } from './url-state.js';
import store from '../state/store.js';
import lifecycle from './lifecycle.js';

export const WEB_VERSION='0.10.2';
window.COLLECTISH_WEB_VERSION=WEB_VERSION;

const ROUTES={
  scout:{label:'Singles',group:'scout'},
  sealed:{label:'Sealed',group:'scout'},
  signals:{label:'Signals',group:'signals'},
  seller:{label:'Overview',group:'selling'},
  syp:{label:'SYP',group:'selling'},
  inventory:{label:'Inventory',group:'selling'},
  admin:{label:'Admin',group:'system'}
};
const GROUPS={
  scout:{label:'Scout',home:'scout',routes:['scout','sealed'],description:'Find the best opportunities.'},
  signals:{label:'Signals',home:'signals',routes:['signals'],description:'Understand what is moving.'},
  selling:{label:'Selling',home:'seller',routes:['seller','syp','inventory'],description:'Manage sales and inventory.'},
  system:{label:'System',home:'admin',routes:['admin'],description:'Operations and account.'}
};
const PRIMARY_GROUPS=['scout','signals','selling'];
const groupLastRoute={scout:'scout',signals:'signals',selling:'seller',system:'admin'};

const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));
const brand=()=>'<span class="cx-brand-collect">collect</span><span class="cx-brand-ish">ish</span>';
const routeMeta=name=>ROUTES[name]||ROUTES.scout;
const groupMeta=name=>GROUPS[name]||GROUPS.scout;
let started=false;
let beforeReadyHook=null;
let stopUrlListener=null;

export function startupView(message='Resuming your session…'){lifecycle.unmountApp();store.update('runtime',{screen:'startup'});document.body.innerHTML=`<main class="cx-auth" data-collectish-startup><section class="cx-auth-card"><div class="cx-brand">${brand()}</div><div class="cx-version">web ${WEB_VERSION}</div><h1>Collectish</h1><p>${esc(message)}</p><div class="cx-auth-msg">Loading…</div></section></main>`;document.dispatchEvent(new CustomEvent('collectish:shell-rendered',{detail:{screen:'startup'}}))}
export function loginView(message=''){lifecycle.unmountApp();store.batch(()=>{store.update('session',{user:null});store.update('runtime',{screen:'login'})});document.body.innerHTML=`<main class="cx-auth"><section class="cx-auth-card"><div class="cx-brand">${brand()}</div><div class="cx-version">web ${WEB_VERSION}</div><h1>Sign in</h1><p>Find opportunities, understand market signals, and manage selling from one workspace.</p><input id="modernEmail" type="email" autocomplete="email" placeholder="Email"><input id="modernPassword" type="password" autocomplete="current-password" placeholder="Password"><button id="modernSignIn" class="cx-primary">Sign in</button><div id="modernMsg" class="cx-auth-msg">${esc(message)}</div></section></main>`;document.getElementById('modernSignIn')?.addEventListener('click',login);document.getElementById('modernPassword')?.addEventListener('keydown',e=>{if(e.key==='Enter')login()});document.dispatchEvent(new CustomEvent('collectish:shell-rendered',{detail:{screen:'login'}}))}
async function login(){const email=document.getElementById('modernEmail')?.value.trim();const password=document.getElementById('modernPassword')?.value||'';const msg=document.getElementById('modernMsg');const btn=document.getElementById('modernSignIn');if(!email||!password){if(msg)msg.textContent='Enter email and password.';return}if(btn)btn.disabled=true;if(msg)msg.textContent='Signing in…';try{await signIn(email,password);startupView('Opening Collectish…');await boot()}catch(error){if(btn)btn.disabled=false;loginView(error.message||'Sign in failed')}}
export function adminView(){const host=document.getElementById('cxAdmin');if(!host)return;host.innerHTML=`<div class="cx-page-head"><div><h2>System</h2><p>Cloud operations, health, build identity, and account.</p></div></div><div class="cx-grid"><div class="cx-card cx-span-6"><div class="cx-section-title">Build</div><div class="cx-detail-list"><div class="cx-detail-stat"><span>Web UI</span><strong>${WEB_VERSION}</strong></div><div class="cx-detail-stat"><span>Frontend</span><strong>Vite hosted shell</strong></div><div class="cx-detail-stat"><span>Scout source</span><strong>v5 promoted rankings</strong></div></div></div><div class="cx-card cx-span-6"><div class="cx-section-title">Account</div><button id="modernSignOut" class="cx-refresh">Sign out</button></div></div>`;document.getElementById('modernSignOut')?.addEventListener('click',()=>{saveSession(null);loginView()})}

function desktopGroup(group){const meta=groupMeta(group);return `<section class="cx-nav-group" data-cx-nav-group="${group}"><div class="cx-nav-group-label"><strong>${meta.label}</strong><small>${meta.description}</small></div><div class="cx-nav-sub">${meta.routes.map(route=>`<button data-cx-page="${route}" class="${route===meta.home?'active':''}">${routeMeta(route).label}</button>`).join('')}</div></section>`}
function contextGroups(){return Object.entries(GROUPS).map(([group,meta])=>`<nav class="cx-route-tabs" data-cx-route-group="${group}" ${group==='scout'?'':'hidden'} aria-label="${meta.label} sections">${meta.routes.map(route=>`<button type="button" data-cx-page="${route}" class="${route===meta.home?'active':''}">${routeMeta(route).label}</button>`).join('')}</nav>`).join('')}
function mobileGroup(group){const meta=groupMeta(group);return `<button type="button" data-cx-group-nav="${group}" class="${group==='scout'?'active':''}"><span>${meta.label}</span></button>`}
function syncNavigation(name){const route=routeMeta(name),group=route.group;groupLastRoute[group]=name;document.querySelectorAll('[data-cx-page]').forEach(el=>el.classList.toggle('active',el.dataset.cxPage===name));document.querySelectorAll('[data-cx-group-nav]').forEach(el=>el.classList.toggle('active',el.dataset.cxGroupNav===group));document.querySelectorAll('[data-cx-nav-group]').forEach(el=>el.classList.toggle('active',el.dataset.cxNavGroup===group));document.querySelectorAll('[data-cx-route-group]').forEach(el=>{el.hidden=el.dataset.cxRouteGroup!==group});const context=document.getElementById('cxRouteContext');if(context)context.dataset.group=group;store.update('runtime',{page:name,productGroup:group})}

export function switchPage(name,{scroll=true,history=true,replace=false}={}){if(!ROUTES[name])name='scout';const targetId=`cx${name[0].toUpperCase()+name.slice(1)}`;document.querySelectorAll('.cx-page').forEach(el=>el.classList.toggle('active',el.id===targetId));syncNavigation(name);lifecycle.setPage(name);if(history)writeUrlState({tab:name},{replace});if(name==='admin')adminView();if(scroll)window.scrollTo({top:0,behavior:'smooth'});document.dispatchEvent(new CustomEvent('collectish:page-change',{detail:{page:name,group:routeMeta(name).group}}))}
export function switchGroup(group,{scroll=true}={}){const meta=GROUPS[group];if(!meta)return;switchPage(groupLastRoute[group]||meta.home,{scroll})}

export function renderShell(){document.body.innerHTML=`<div id="cxNetworkProgress" class="cx-network-progress" aria-hidden="true"><div class="cx-network-progress-runner"></div></div><div class="cx-top-version">web ${WEB_VERSION}</div><main id="app" class="collectish-modern-app"><section id="collectishUxShell" class="collectish-product-shell"><aside class="cx-side"><div class="cx-brand">${brand()}</div><nav class="cx-nav" aria-label="Collectish workspace">${PRIMARY_GROUPS.map(desktopGroup).join('')}</nav><div class="cx-side-spacer"></div><div class="cx-side-tools"><button data-cx-page="admin">System</button></div><div class="cx-side-meta">web ${WEB_VERSION}<br>Smarter data. Better decisions.</div></aside><div class="cx-main"><div id="cxRouteContext" class="cx-route-context" data-group="scout">${contextGroups()}</div><section id="cxScout" class="cx-page active"></section><section id="cxSignals" class="cx-page"></section><section id="cxSealed" class="cx-page"></section><section id="cxSeller" class="cx-page"></section><section id="cxSyp" class="cx-page"></section><section id="cxInventory" class="cx-page"></section><section id="cxAdmin" class="cx-page"></section></div><nav class="cx-mobile-nav" aria-label="Primary navigation">${PRIMARY_GROUPS.map(mobileGroup).join('')}<button type="button" data-cx-group-nav="system" class="cx-mobile-more"><span>More</span></button></nav></section></main>`;store.update('runtime',{screen:'app',page:'scout',productGroup:'scout'});document.dispatchEvent(new CustomEvent('collectish:shell-rendered',{detail:{screen:'app'}}))}
function pageClickHandler(event){const page=event.target.closest?.('[data-cx-page]');if(page){switchPage(page.dataset.cxPage);return}const group=event.target.closest?.('[data-cx-group-nav]');if(group)switchGroup(group.dataset.cxGroupNav)}
export async function boot(){const session=await validSession();if(!session){loginView();return null}store.update('session',{user:session.user});renderShell();if(beforeReadyHook)await beforeReadyHook();lifecycle.mountApp();const initial=readUrlState().tab;switchPage(ROUTES[initial]?initial:'scout',{scroll:false,history:false});document.dispatchEvent(new CustomEvent('collectish:ready',{detail:{version:WEB_VERSION,user:session.user}}));return session}
export function startShell({beforeReady}={}){if(typeof beforeReady==='function')beforeReadyHook=beforeReady;if(started)return;started=true;document.addEventListener('click',pageClickHandler,true);document.addEventListener('collectish:auth-invalid',()=>loginView('Your session was rejected by the server. Please sign in again.'));stopUrlListener=onUrlStateChange(state=>{if(store.get().runtime?.screen==='app')switchPage(ROUTES[state.tab]?state.tab:'scout',{scroll:false,history:false})});if(readSession())startupView();else loginView();void boot().catch(error=>{console.error('Collectish boot failed',error);store.update('runtime',{screen:'error',bootError:String(error?.message||error)});loginView('Collectish could not resume your session. Please sign in again.')});window.CollectishShell={boot,switchPage,switchGroup,adminView,loginView,startupView,version:WEB_VERSION,session:readSession,routes:ROUTES,groups:GROUPS}}
export { collectishConfig };
