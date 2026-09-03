import transport from './discord-ask-entry.mjs';
import { secretLairMediaEmbed } from './discord-secret-lair-media.mjs';
import { rewriteStructuredDiscordOutput } from './discord-structured-output.mjs';
import { maybeHandleFastQuery } from './discord-fast-query-cache.mjs';
import { maybeHandleMarketIntelFast } from './discord-market-intel-fast.mjs';
import { maybeHandleUserWatch, deliverPendingUserWatches } from './discord-user-watches.mjs';

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

// v30 keeps routing in the shared Ask API, but known public market queries may be
// answered from the precomputed Delvin cache before Queue latency. Persistent
// Discord watches are guest-first and owned by Discord user identity; an optional
// Collectish link may enrich them later but never gates creation or management.
export default {
  async fetch(request,env,ctx){
    const watch=await maybeHandleUserWatch(request,env,ctx);
    if(watch)return watch;
    const intel=await maybeHandleMarketIntelFast(request,env,ctx);
    if(intel)return intel;
    const fast=await maybeHandleFastQuery(request,env,ctx);
    return fast||transport.fetch(request,env,ctx);
  },
  async queue(batch,env,ctx){
    const jobs=batch.messages.map(m=>m.body||{});
    await transport.queue(batch,env,ctx);
    await Promise.all(jobs.map(job=>rewriteStructuredDiscordOutput(env,job)));
    await Promise.all(jobs.map(job=>attachSecretLairMedia(env,job)));
  },
  async scheduled(_controller,env,ctx){
    ctx?.waitUntil?.(deliverPendingUserWatches(env));
  },
};
