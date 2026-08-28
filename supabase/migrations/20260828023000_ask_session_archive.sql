alter table public.ask_collectish_conversations
  add column if not exists archived_at timestamptz;

create index if not exists ask_collectish_conversations_active_user_updated_idx
  on public.ask_collectish_conversations (user_id, updated_at desc)
  where archived_at is null;

create index if not exists ask_collectish_conversations_archived_user_updated_idx
  on public.ask_collectish_conversations (user_id, archived_at desc, updated_at desc)
  where archived_at is not null;
