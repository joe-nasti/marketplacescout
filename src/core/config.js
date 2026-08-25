const injectedAskStreamUrl=String(window.COLLECTISH_ASK_STREAM_URL||document.querySelector('meta[name="collectish-ask-stream-url"]')?.content||'').trim();

const askPrefetchHost=String(window.location?.hostname||'').toLowerCase();
const askPrefetchRestrictedHost=askPrefetchHost==='localhost'||askPrefetchHost==='127.0.0.1'||askPrefetchHost==='::1'||askPrefetchHost.endsWith('.github.io');

export const ASK_PREFETCH_CONFIG = Object.freeze({
  // Speculative AI work is opt-in everywhere. This guarantees localhost and
  // github.io never consume quota unless a developer explicitly enables it.
  get enabled(){
    return localStorage.getItem('COLLECTISH_ASK_PREFETCH')==='true';
  },
  restrictedHost:askPrefetchRestrictedHost,
  ttlMs:1000*60*15
});

export const collectishConfig = Object.freeze({
  supabaseUrl: 'https://bnsnlikjeogzdubgyvxk.supabase.co',
  publishableKey: 'sb_publishable_Zl0XS3ueisENWcQAmQ0mwA_FIC4yje2',
  askStreamUrl: injectedAskStreamUrl,
  askPrefetch: ASK_PREFETCH_CONFIG
});

// Compatibility bridge for legacy modules during the ES-module migration.
window.COLLECTISH_CONFIG = collectishConfig;
window.COLLECTISH_ASK_PREFETCH_CONFIG = ASK_PREFETCH_CONFIG;

export default collectishConfig;
