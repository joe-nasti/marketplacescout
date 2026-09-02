// Register Collectish Discord application commands.
// Usage:
//   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node cloud-worker/register-discord-commands.mjs
// Optional DISCORD_GUILD_ID registers immediately in one guild for development.

const applicationId=String(process.env.DISCORD_APPLICATION_ID||'').trim();
const botToken=String(process.env.DISCORD_BOT_TOKEN||'').trim();
const guildId=String(process.env.DISCORD_GUILD_ID||'').trim();
if(!applicationId||!botToken)throw new Error('DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required');

const commands=[{
  name:'ask',
  description:'Ask Collectish about MTG cards, markets, Scout, or Signals',
  type:1,
  dm_permission:true,
  options:[{
    type:3,
    name:'question',
    description:'What do you want to ask Collectish?',
    required:true,
    autocomplete:true,
    min_length:1,
    max_length:4000
  }]
}];

const scope=guildId?`applications/${applicationId}/guilds/${guildId}/commands`:`applications/${applicationId}/commands`;
const response=await fetch(`https://discord.com/api/v10/${scope}`,{
  method:'PUT',
  headers:{Authorization:`Bot ${botToken}`,'Content-Type':'application/json'},
  body:JSON.stringify(commands)
});
const text=await response.text();
if(!response.ok)throw new Error(`Discord command registration failed (${response.status}): ${text.slice(0,500)}`);
console.log(`Registered ${commands.length} command(s) ${guildId?`for guild ${guildId}`:'globally'} with /ask question autocomplete enabled.`);
