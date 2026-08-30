# Collectish Ask on Discord

The Discord application is a transport for the existing Ask Collectish service. It does not query Scout, Signals, seller data, or Ask persistence directly.

## Runtime shape

```text
Discord /ask
    |
    v
Cloudflare Worker /discord/interactions
    | verify signature + enqueue + deferred ephemeral ACK
    v
Cloudflare Queue
    |
    v
same Worker queue consumer
    | refresh user-scoped Collectish OAuth token
    | load Discord thread -> Ask session binding
    v
Supabase ask-collectish-api
    |
    v
existing Ask orchestrator / Scout / Signals / market tools
    |
    v
PATCH original Discord interaction response
```

The HTTP ingress is stateless and autoscalable. Ask concurrency is controlled by the Queue consumer rather than by the number of Discord requests arriving at once.

## Why OAuth instead of copying a browser session

Supabase Auth's OAuth 2.1 Server issues a dedicated access/refresh token pair for the Discord application. The access token is still a normal user-scoped Supabase JWT, so the existing Ask Row Level Security policies apply. The Discord service never needs service-role access to Ask data.

`SUPABASE_SERVICE_ROLE_KEY` is used only for the bot's integration metadata tables (`discord_collectish_*`, `discord_ask_bindings`, and delivery idempotency). The worker then calls `ask-collectish-api` with the linked user's OAuth access token.

OAuth refresh tokens are encrypted with AES-256-GCM before storage. The encryption key is a Worker secret and is never stored in Supabase.

## Database objects

Migration `20260830010500_discord_ask_identity_and_sessions.sql` creates:

- `discord_collectish_links`: user-owned non-secret Discord identity mapping.
- `discord_collectish_oauth_credentials`: encrypted OAuth refresh token material; no authenticated RLS policy.
- `discord_ask_bindings`: Discord channel/thread to durable Ask session mapping.
- `discord_ask_deliveries`: queue idempotency and saved response text for retry-safe Discord delivery.
- `claim_discord_ask_delivery(...)`: service-role-only atomic queue claim/reclaim RPC.

Deleting a user's `discord_collectish_links` row cascades credentials and thread bindings.

## Supabase OAuth Server setup

This requires a one-time project configuration in the Supabase dashboard:

1. Authentication -> OAuth Server -> enable OAuth 2.1 Server.
2. Set the authorization path to `/oauth/consent`.
3. Confirm the Authentication Site URL is the production Collectish web origin (including the GitHub Pages project prefix if applicable).
4. Create a **confidential** OAuth client named `Collectish Discord`.
5. Register the exact Worker callback URI, for example `https://<worker-host>/discord/oauth/callback`.
6. Use `client_secret_basic` (the default for confidential clients).
7. Save the generated client ID/secret as Worker secrets.

The Vite finalizer publishes `dist/oauth/consent/index.html`, and `src/main.js` routes that page to the dedicated OAuth consent module. The page uses the existing Collectish session system and directly calls Supabase Auth's authorization-details and consent endpoints.

## Discord application setup

Create one Discord application/bot and configure:

- Interactions Endpoint URL: `https://<worker-host>/discord/interactions`
- Install contexts desired for the MVP (guild and/or user install)
- Bot/application permissions appropriate for slash commands; reading arbitrary server messages is not required for `/ask`

Register the command with:

```bash
DISCORD_APPLICATION_ID=... \
DISCORD_BOT_TOKEN=... \
node cloud-worker/register-discord-commands.mjs
```

Set `DISCORD_GUILD_ID` during development for immediate guild-scoped registration. Omit it for global registration.

## Cloudflare resources

Deploy `cloud-worker/discord-ask-worker.mjs` as a Worker with both HTTP and Queue handlers.

Create:

- Queue: `collectish-discord-ask`
  - producer binding: `DISCORD_ASK_QUEUE`
  - consumer: the same Worker
  - recommended initial max batch size: 5
  - recommended initial consumer concurrency: 5
  - retry count: 3+
- KV namespace:
  - binding: `DISCORD_LINK_STATE`
  - contains only short-lived PKCE/link state (10 minute TTL)

The integration is deliberately queue-first. Do not replace the queue with an in-request Ask call; Discord requires the interaction to be acknowledged quickly and Ask can run substantially longer.

## Worker configuration

Required vars/secrets:

```text
DISCORD_PUBLIC_KEY
DISCORD_APPLICATION_ID
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
COLLECTISH_OAUTH_CLIENT_ID
COLLECTISH_OAUTH_CLIENT_SECRET
COLLECTISH_OAUTH_REDIRECT_URI
DISCORD_TOKEN_ENCRYPTION_KEY
DISCORD_LINK_TICKET_SECRET
DISCORD_WORKER_BASE_URL
```

Generate `DISCORD_TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded as base64. `DISCORD_LINK_TICKET_SECRET` should be an independent high-entropy secret.

Do not expose the service-role key, OAuth client secret, encryption key, or link-ticket secret to the web application.

## First-use flow

1. User runs `/ask Why is Roaming Throne moving?`.
2. Discord gets an immediate private deferred response.
3. Queue consumer sees no linked Collectish account and edits the response with **Link Collectish**.
4. Link URL contains a short-lived HMAC-signed Discord identity ticket.
5. Worker starts OAuth Authorization Code + PKCE against the Collectish Supabase project.
6. Supabase redirects to Collectish `/oauth/consent`.
7. User signs in if needed and approves `Collectish Discord`.
8. Worker callback exchanges the code, identifies the Supabase user, encrypts the refresh token, and stores the Discord-to-user link.
9. User runs `/ask` again.
10. Worker refreshes a user-scoped token, calls `ask-collectish-api`, saves the returned `session_id`, and edits the Discord response.
11. Later `/ask` calls in the same Discord channel/thread reuse that durable Ask session.

## Privacy defaults

`/ask` is deferred with Discord's ephemeral flag by default. This is intentional because Ask can eventually incorporate seller/inventory/account-specific data. A later explicit **Share to channel** action can sanitize and publish an answer; public output should not be the default.

The MVP does not ingest arbitrary server history. Only the slash-command question and Discord routing identifiers are sent to Ask.

## Retry and duplicate safety

Cloudflare Queues are at-least-once. The worker atomically claims `interaction_id` in Supabase. Before editing Discord it stores `response_text`; if the webhook edit fails, the queue retry delivers that saved result instead of invoking Ask again. A `running` delivery older than two minutes can be reclaimed after a worker crash.

## Remaining deployment prerequisites

Code can be merged before these values exist, but the bot cannot go live until all three external pieces are configured:

1. Discord application credentials and Interactions Endpoint.
2. Supabase OAuth Server + confidential OAuth client.
3. Cloudflare Worker, Queue, KV, and secrets.

None of those secrets belong in this repository.
