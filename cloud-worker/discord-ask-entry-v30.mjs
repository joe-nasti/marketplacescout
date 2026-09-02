import transport from './discord-ask-entry.mjs';
import { secretLairMediaEmbed } from './discord-secret-lair-media.mjs';
import { rewriteStructuredDiscordOutput } from './discord-structured-output.mjs';
import { maybeHandleFastQuery } from './discord-fast-query-cache.mjs';

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
// answered from the precomputed Delvin cache before Queue latency. Cache misses and
// noncanonical questions continue through the normal transport/Ask path.
export default {
  async fetch(request,env,ctx){
    const fast=await maybeHandleFastQuery(request,env,ctx);
    return fast||transport.fetch(request,env,ctx);
  },
  async queue(batch,env,ctx){
    const jobs=batch.messages.map(m=>m.body||{});
    await transport.queue(batch,env,ctx);
    await Promise.all(jobs.map(job=>rewriteStructuredDiscordOutput(env,job)));
    await Promise.all(jobs.map(job=>attachSecretLairMedia(env,job)));
  },
};
