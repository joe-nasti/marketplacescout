# Ask Collectish client API

`ask-collectish-api` is the stable authenticated boundary for every Ask Collectish client. The web app, Discord, and future clients should call this function instead of calling `ask-collectish-orchestrator` or the Ask persistence tables directly.

## Authentication

Send the signed-in Collectish user's Supabase access token as:

```http
Authorization: Bearer <user-jwt>
```

The Edge Function keeps that user JWT when it calls PostgREST or the internal orchestrator, so the existing `ask_collectish_conversations` and `ask_collectish_messages` RLS policies remain authoritative. Do not use a service-role token for normal Ask clients.

## Schema

Responses from this facade include:

```json
{
  "api_schema": "collectish.ask.api.v1"
}
```

Existing orchestrator fields remain intact for chat responses, including `response`, `tools`, `surfaces`, `surface_schema`, `model`, and `usage`.

`session_id` is the public client name for an Ask conversation. Chat responses currently also retain the legacy `conversation_id` field for backwards compatibility.

## Chat

```json
{
  "action": "chat",
  "client": "discord",
  "session_id": "optional-existing-session-uuid",
  "message": "Why is Roaming Throne moving?",
  "context": {
    "screen": "discord",
    "product_id": "optional",
    "sku_id": "optional"
  }
}
```

If `session_id` is omitted, the existing orchestrator creates a durable Ask session on the first message. If it is supplied, the facade translates it to the orchestrator's legacy `conversation_id` field.

The facade touches `updated_at` after successful chat calls so recent-session ordering does not depend on a browser-only side effect.

## Session actions

### Create

```json
{
  "action": "session.create",
  "title": "Roaming Throne investigation"
}
```

Returns a public session object with `id`, `title`, `created_at`, and `updated_at`.

### List

```json
{
  "action": "session.list",
  "limit": 30
}
```

`limit` is clamped to 1–100. RLS restricts results to the authenticated user.

### Get

```json
{
  "action": "session.get",
  "session_id": "session-uuid"
}
```

Returns the session plus up to 250 persisted messages in chronological order. RLS prevents one user from reading another user's session even if they know its UUID.

## Health and existing actions

`health` and other existing orchestrator actions are forwarded unchanged through the facade. This lets clients adopt the stable endpoint without duplicating Ask behavior.

## Discord adapter rule

The Discord service should remain a transport adapter. It should:

1. authenticate/link a Discord identity to a Collectish user,
2. map Discord channel/thread identifiers to an Ask `session_id`,
3. call `ask-collectish-api`, and
4. render the returned text/surfaces into Discord-native messages and embeds.

It should not query Scout, Signals, seller data, or Ask persistence tables directly.
