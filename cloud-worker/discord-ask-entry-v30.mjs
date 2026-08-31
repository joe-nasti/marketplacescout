// Discord v30 intentionally owns no Collectish business routing.
//
// All card identity recovery, price-history, seller-map, cohort, and named-family
// intent ownership lives behind ask-collectish-api. This entrypoint preserves the
// production Discord transport/account-link/guest behavior only.
import entry from './discord-ask-entry.mjs';

export default entry;
