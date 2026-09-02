create index if not exists market_intel_items_video_event_key_idx
  on public.market_intel_items (user_id, ((metadata_json->>'video_event_key')))
  where coalesce(metadata_json->>'video_event_key','') <> '';

create or replace function public.enforce_canonical_youtube_signal_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_video_id text;
  v_event_key text;
begin
  v_video_id := nullif(trim(coalesce(new.metadata_json->>'video_id','')), '');
  v_event_key := nullif(trim(coalesce(new.metadata_json->>'video_event_key','')), '');

  if lower(coalesce(new.source_type,'')) = 'youtube' and v_video_id is not null then
    new.source_url := 'https://www.youtube.com/watch?v=' || v_video_id;
  end if;

  if tg_op = 'INSERT' and v_event_key is not null then
    if exists (
      select 1
      from public.market_intel_items i
      where i.user_id = new.user_id
        and coalesce(i.metadata_json->>'video_event_key','') = v_event_key
    ) then
      return null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_market_intel_youtube_identity on public.market_intel_items;
create trigger trg_market_intel_youtube_identity
before insert or update of source_url, source_type, metadata_json
on public.market_intel_items
for each row
execute function public.enforce_canonical_youtube_signal_identity();

update public.market_intel_items
set source_url = 'https://www.youtube.com/watch?v=' || (metadata_json->>'video_id')
where lower(coalesce(source_type,'')) = 'youtube'
  and nullif(trim(coalesce(metadata_json->>'video_id','')), '') is not null
  and source_url is distinct from 'https://www.youtube.com/watch?v=' || (metadata_json->>'video_id');
