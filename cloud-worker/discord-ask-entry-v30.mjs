import transport from './discord-ask-entry.mjs';

// v30 intentionally owns no market, seller, price-history, cohort, or card-family
// routing. Those intents are resolved by the stable Ask API and its shared router.
export default {
  fetch(request,env,ctx){return transport.fetch(request,env,ctx)},
  queue(batch,env,ctx){return transport.queue(batch,env,ctx)},
};
