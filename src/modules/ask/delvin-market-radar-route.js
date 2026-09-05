// Shared deterministic Delvin route for Collectish app Ask.
// Calls the same server-side resolver + presentation contract used by Discord before generic Ask orchestration.
(() => {
  if (window.__CollectishDelvinSharedRouteInstalled) return;
  window.__CollectishDelvinSharedRouteInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const isAskEndpoint = input => {
    const u = typeof input === 'string' ? input : input?.url || '';
    return /\/functions\/v1\/ask-collectish(?:\?|$)/.test(String(u));
  };
  const resolverUrl = input => {
    const u = new URL(typeof input === 'string' ? input : input?.url || '', location.href);
    return `${u.origin}/functions/v1/ask-collectish-delvin-present-v3`;
  };

  window.fetch = async function(input, init = {}) {
    if (!isAskEndpoint(input) || String(init?.method || 'GET').toUpperCase() !== 'POST') return nativeFetch(input, init);
    let body = null;
    try { body = JSON.parse(String(init?.body || '{}')); } catch { return nativeFetch(input, init); }
    if (body?.action !== 'chat' || !String(body?.message || body?.question || '').trim()) return nativeFetch(input, init);

    try {
      const headers = new Headers(init?.headers || {});
      headers.set('Content-Type', 'application/json');
      const routed = await nativeFetch(resolverUrl(input), {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: body.message || body.question, context: body.context || null, client: 'web' })
      });
      if (routed.ok) {
        const data = await routed.json();
        if (data?.handled && data?.response) {
          return new Response(JSON.stringify({
            ok: true,
            conversation_id: body.conversation_id || null,
            response: data.response,
            model: 'Delvin deterministic',
            usage: { total_tokens: 0 },
            tools: [{ name: 'ask-collectish-delvin-present-v3', ok: true, classification: 'READ' }],
            ui_actions: data?.presentation?.actions || [],
            context_screen: 'market',
            deterministic_route: data.route || 'shared_delvin',
            orchestration: {
              shared_delvin_router: true,
              shared_presentation_contract: true,
              deterministic_route: data.route || 'shared_delvin',
              presentation_version: data.presentation_version || data?.presentation?.version || 2
            },
            presentation: data.presentation || null,
            presentation_version: data.presentation_version || data?.presentation?.version || 2,
            surfaces: data.surfaces || [],
            generated_at: data?.data?.generated_at || data?.data?.generated_from_cache_at || null
          }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }
      }
    } catch (e) {
      console.warn('Shared Delvin route failed; using normal Ask path', e);
    }
    return nativeFetch(input, init);
  };
})();
