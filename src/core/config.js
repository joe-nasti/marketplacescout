const injectedAskStreamUrl=String(window.COLLECTISH_ASK_STREAM_URL||document.querySelector('meta[name="collectish-ask-stream-url"]')?.content||'').trim();

export const collectishConfig = Object.freeze({
  supabaseUrl: 'https://bnsnlikjeogzdubgyvxk.supabase.co',
  publishableKey: 'sb_publishable_Zl0XS3ueisENWcQAmQ0mwA_FIC4yje2',
  askStreamUrl: injectedAskStreamUrl
});

// Compatibility bridge for legacy modules during the ES-module migration.
window.COLLECTISH_CONFIG = collectishConfig;

export default collectishConfig;
