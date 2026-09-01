create or replace function public.normalize_mtgstocks_interest_capture_date()
returns trigger
language plpgsql
as $$
declare
  raw_date text;
  normalized text;
begin
  if new.source = 'MTGStocks'
     and new.capture_type = 'discovery_candidate'
     and new.payload_json is not null then
    raw_date := btrim(new.payload_json->>'date');
    if raw_date is not null
       and raw_date <> ''
       and raw_date !~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        normalized := to_char(to_date(raw_date, 'Month DD, YYYY'), 'YYYY-MM-DD');
        if normalized ~ '^\d{4}-\d{2}-\d{2}$' then
          new.payload_json := jsonb_set(
            new.payload_json,
            '{date}',
            to_jsonb(normalized),
            true
          );
        end if;
      exception when others then
        null;
      end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_mtgstocks_interest_capture_date
  on public.source_captures;

create trigger trg_normalize_mtgstocks_interest_capture_date
before insert or update of payload_json on public.source_captures
for each row
execute function public.normalize_mtgstocks_interest_capture_date();

update public.source_captures
set payload_json = jsonb_set(
  payload_json,
  '{date}',
  to_jsonb(
    to_char(
      to_date(btrim(payload_json->>'date'), 'Month DD, YYYY'),
      'YYYY-MM-DD'
    )
  ),
  true
)
where source = 'MTGStocks'
  and capture_type = 'discovery_candidate'
  and coalesce(payload_json->>'date', '') <> ''
  and payload_json->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
  and payload_json->>'date' ~ '^[A-Za-z]+\s+\d{1,2},\s+\d{4}$';
