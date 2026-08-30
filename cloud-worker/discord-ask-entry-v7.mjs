import ingress from './discord-ask-entry-v6.mjs';
import sharedAsk from './discord-ask-entry-v2.mjs';

// Discord should not maintain a second intent router for questions that the
// Collectish Ask orchestrator already understands. v6 continues to own signed
// interaction ingress, visibility (public vs private), and immediate deferral.
// For market investigation, history/timeline, and explicit deep/web research,
// route the queued job through the same Ask API/orchestrator used by the app.
// Other jobs keep the richer Discord-specific renderers layered under v6.

function useSharedCollectishRouter(question) {
  const q = String(question || '').trim();
  return [
    // Market causality / investigation.
    /\bwhy\s+(?:is|did)\b.*\b(?:moving|move|spiking|spike|rising|rise|jump|jumped)\b/i,
    /\bwhat\s+(?:is|was)\s+driving\b/i,
    /\bwhat\s+drove\b/i,
    /\binvestigate\b|\bdeep\s*dive\b|\bdig\s+deeper\b|\bfull\s+analysis\b/i,

    // Explicit external research. The shared orchestrator owns Path 4.
    /\b(?:search|research)\s+(?:the\s+)?web\b/i,
    /\bresearch\s+(?:this|it|externally|online)\b/i,
    /\blook\s+(?:it\s+)?up\s+online\b|\blook\s+online\b/i,
    /\bexternal\s+research\b|\bweb\s+research\b/i,
    /\bfind\s+(?:recent\s+)?(?:news|articles|discussion)\b/i,

    // Historical/timeline/chart-like questions. The shared router should own
    // the data intent; Discord can render returned surfaces separately.
    /\b(?:price|market|sales?|sale)\s+history\b/i,
    /\b(?:graph|chart|plot|visuali[sz]e)\b/i,
    /\bover\s+the\s+(?:last|past)\s+\d+\s*(?:days?|weeks?|months?|years?)\b/i,
    /\bsince\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|the\s+.+?\s+set)\b/i,
    /\bwhat\s+changed\b|\bwhat\s+happened\s+first\b|\bmarket\s+timeline\b|\bevent\s+timeline\b/i,
  ].some((pattern) => pattern.test(q));
}

export default {
  fetch(request, env, ctx) {
    return ingress.fetch(request, env, ctx);
  },

  queue(batch, env, ctx) {
    const shared = [];
    const discordSpecific = [];
    for (const message of batch.messages) {
      const question = message?.body?.question || '';
      (useSharedCollectishRouter(question) ? shared : discordSpecific).push(message);
    }

    const tasks = [];
    if (shared.length) tasks.push(sharedAsk.queue({ messages: shared }, env, ctx));
    if (discordSpecific.length) tasks.push(ingress.queue({ messages: discordSpecific }, env, ctx));
    return Promise.all(tasks);
  },
};
