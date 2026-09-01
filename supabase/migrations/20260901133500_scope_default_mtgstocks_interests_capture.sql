create or replace function public.mirror_canonical_mtgstocks_interest_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date text;
  v_name text;
  v_payload jsonb;
  v_capture_type text;
begin
  if new.source_name is distinct from 'MTGStocks' or new.source_subtype is distinct from 'interests' then
    return new;
  end if;

  v_date := coalesce(new.metadata_json->>'source_date', to_char(new.observed_at at time zone 'UTC', 'YYYY-MM-DD'));
  v_name := coalesce(nullif(new.metadata_json->>'original_card_name',''), regexp_replace(coalesce(new.title,''), '^.* · ', ''));
  v_capture_type := case
    when new.metadata_json->>'price_type'='average'
     and new.metadata_json->>'finish'='regular'
     and new.metadata_json->>'window'='24h'
    then 'discovery_candidate'
    else 'mtgstocks_interest_variant'
  end;
  v_payload := jsonb_build_object(
    'card_name', v_name,
    'set_name', new.metadata_json->>'mtgstocks_set_name',
    'set_code', null,
    'price_type', new.metadata_json->>'price_type',
    'finish', new.metadata_json->>'finish',
    'interest_type', new.metadata_json->>'interest_type',
    'pct_change', new.metadata_json->'change_pct',
    'new_price', new.metadata_json->'new_price',
    'old_price', new.metadata_json->'old_price',
    'date', v_date,
    'url', new.source_url,
    'discovery_source', 'canonical_api',
    'window', new.metadata_json->>'window',
    'mtgstocks_print_id', new.metadata_json->>'mtgstocks_print_id'
  );

  if v_capture_type='discovery_candidate' then
    delete from public.source_captures
     where user_id = new.user_id
       and source = 'MTGStocks'
       and capture_type = 'discovery_candidate'
       and payload_json->>'date' = v_date
       and payload_json->>'discovery_source' = 'telegram_announcement';
  end if;

  delete from public.source_captures
   where user_id=new.user_id
     and source='MTGStocks'
     and source_key='canonical:' || new.intel_id::text
     and capture_type<>v_capture_type;

  insert into public.source_captures(
    user_id, source, capture_type, source_key, captured_at,
    content_type, payload_json, payload_text, content_hash, metadata_json
  ) values (
    new.user_id, 'MTGStocks', v_capture_type, 'canonical:' || new.intel_id::text,
    coalesce(new.observed_at, now()), 'application/mtgstocks-interest+json', v_payload,
    v_name || ' ' || coalesce(new.metadata_json->>'interest_type','') || ' ' || coalesce(new.metadata_json->>'change_pct','') || '%',
    md5(v_payload::text),
    jsonb_build_object(
      'kind','canonical_interest',
      'signal_weight','discovery_only',
      'discovery_source','canonical_api',
      'source_date',v_date,
      'window',new.metadata_json->>'window',
      'price_type',new.metadata_json->>'price_type',
      'finish',new.metadata_json->>'finish'
    )
  )
  on conflict (user_id, source, capture_type, source_key)
  do update set
    captured_at = excluded.captured_at,
    payload_json = excluded.payload_json,
    payload_text = excluded.payload_text,
    content_hash = excluded.content_hash,
    metadata_json = excluded.metadata_json;

  return new;
end;
$$;

delete from public.source_captures
where source='MTGStocks'
  and source_key like 'canonical:%';

delete from public.source_captures
where source='MTGStocks'
  and capture_type='discovery_candidate'
  and payload_json->>'discovery_source'='telegram_announcement';

insert into public.source_captures(
  user_id,source,capture_type,source_key,captured_at,content_type,payload_json,payload_text,content_hash,metadata_json
)
select
  m.user_id,
  'MTGStocks',
  case when m.metadata_json->>'price_type'='average' and m.metadata_json->>'finish'='regular' and m.metadata_json->>'window'='24h' then 'discovery_candidate' else 'mtgstocks_interest_variant' end,
  'canonical:' || m.intel_id::text,
  coalesce(m.observed_at,now()),
  'application/mtgstocks-interest+json',
  p.payload,
  p.card_name || ' ' || coalesce(m.metadata_json->>'interest_type','') || ' ' || coalesce(m.metadata_json->>'change_pct','') || '%',
  md5(p.payload::text),
  jsonb_build_object('kind','canonical_interest','signal_weight','discovery_only','discovery_source','canonical_api','source_date',m.metadata_json->>'source_date','window',m.metadata_json->>'window','price_type',m.metadata_json->>'price_type','finish',m.metadata_json->>'finish')
from public.market_intel_items m
cross join lateral (
  select
    coalesce(nullif(m.metadata_json->>'original_card_name',''),regexp_replace(coalesce(m.title,''),'^.* · ','')) as card_name,
    jsonb_build_object(
      'card_name',coalesce(nullif(m.metadata_json->>'original_card_name',''),regexp_replace(coalesce(m.title,''),'^.* · ','')),
      'set_name',m.metadata_json->>'mtgstocks_set_name',
      'set_code',null,
      'price_type',m.metadata_json->>'price_type',
      'finish',m.metadata_json->>'finish',
      'interest_type',m.metadata_json->>'interest_type',
      'pct_change',m.metadata_json->'change_pct',
      'new_price',m.metadata_json->'new_price',
      'old_price',m.metadata_json->'old_price',
      'date',m.metadata_json->>'source_date',
      'url',m.source_url,
      'discovery_source','canonical_api',
      'window',m.metadata_json->>'window',
      'mtgstocks_print_id',m.metadata_json->>'mtgstocks_print_id'
    ) as payload
) p
where m.source_name='MTGStocks'
  and m.source_subtype='interests'
  and coalesce(m.metadata_json->>'source_date','')<>''
on conflict (user_id,source,capture_type,source_key)
do update set captured_at=excluded.captured_at,payload_json=excluded.payload_json,payload_text=excluded.payload_text,content_hash=excluded.content_hash,metadata_json=excluded.metadata_json;
