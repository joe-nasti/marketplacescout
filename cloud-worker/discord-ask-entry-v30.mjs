import transport from './discord-ask-entry.mjs';
import { secretLairMediaEmbed } from './discord-secret-lair-media.mjs';
import { rewriteStructuredDiscordOutput } from './discord-structured-output.mjs';
import { deliverQueuedSharedQuestion, isQueuedSharedQuestion, maybeHandleSharedDelvinRoute } from './discord-shared-delvin-route.mjs';
import { maybeHandleFastQuery } from './discord-fast-query-cache.mjs';
import { maybeHandleMarketIntelFast } from './discord-market-intel-fast.mjs';
import { maybeHandleCardInvestigator } from './discord-card-investigator.mjs';
import { maybeHandleCollectibleCohortThesis } from './discord-collectible-cohort-thesis.mjs';
import { maybeHandleFamilySetIntel } from './discord-family-set-intel.mjs';
import { maybeHandleSignalHistory } from './discord-signal-history.mjs';
import { maybeHandleUserWatch, deliverPendingUserWatches } from './discord-user-watches.mjs';
import { deliverPendingResearchBackfills } from './discord-research-backfills.mjs';

const DISCORD_API='https://discord.com/api/v10';
const base=env=>String(env.SUPABASE_URL||'').replace(/\/$/,'');
async function responseText(env,interactionId){
  if(!env.SUPABASE_SERVICE_ROLE_KEY||!interactionId)return'';
  const r=await fetch(`${base(env)}/rest/v1/discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(interactionId)}&select=response_text&limit=1`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});
  if(!r.ok)return'';const rows=await r.json().catch(()=>[]);return rows?.[0]?.response_text||'';
}
async function attachSecretLairMedia(env,job){
  try{
    if(!job?.application_id||!job?.interaction_token)return;
    const answer=await responseText(env,job.interaction_id),embed=await secretLairMediaEmbed(env,job.question,answer);if(!embed)return;
    await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({embeds:[embed],allowed_mentions:{parse:[]}})});
  }catch(error){console.warn('secret lair discord thumbnail skipped',String(error?.message||error).slice(0,180))}
}

// v30 uses one shared deterministic resolver for Collectish Ask + Discord wherever
// that resolver has a grounded route. Discord-only watch/alert management stays local.
// Older specialist handlers remain as fallback while their presentation features are
// progressively moved into the shared resolver.
export default {
  async fetch(request,env,ctx){
    const watch=await maybeHandleUserWatch(request,env,ctx);
    if(watch)return watch;
    const shared=await maybeHandleSharedDelvinRoute(request,env,ctx);
    if(shared)return shared;
    const history=await maybeHandleSignalHistory(request,env,ctx);
    if(history)return history;
    const cohort=await maybeHandleCollectibleCohortThesis(request,env,ctx);
    if(cohort)return cohort;
    const family=await maybeHandleFamilySetIntel(request,env,ctx);
    if(family)return family;
    const investigate=await maybeHandleCardInvestigator(request,env,ctx);
    if(investigate)return investigate;
    const intel=await maybeHandleMarketIntelFast(request,env,ctx);
    if(intel)return intel;
    const fast=await maybeHandleFastQuery(request,env,ctx);
    return fast||transport.fetch(request,env,ctx);
  },
  async queue(batch,env,ctx){
    const fallback=[];
    for(const message of batch.messages){
      const job=message.body||{};
      if(!isQueuedSharedQuestion(job.question)){fallback.push(message);continue;}
      const handled=await deliverQueuedSharedQuestion(env,job,message);
      if(!handled)fallback.push(message);
    }
    const jobs=fallback.map(m=>m.body||{});
    if(fallback.length)await transport.queue({messages:fallback},env,ctx);
    await Promise.all(jobs.map(job=>rewriteStructuredDiscordOutput(env,job)));
    await Promise.all(jobs.map(job=>attachSecretLairMedia(env,job)));
  },
  async scheduled(_controller,env,ctx){
    ctx?.waitUntil?.(Promise.all([deliverPendingUserWatches(env),deliverPendingResearchBackfills(env)]));
  },
};
