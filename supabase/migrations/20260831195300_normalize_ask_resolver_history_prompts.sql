create or replace function public.ask_resolve_card_context(p_question text)
returns table(card_name text, product_id bigint, sku_id bigint, scryfall_id uuid, set_code text, collector_number text, printing text, condition text, language text, match_method text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  q text := trim(coalesce(p_question,''));
  candidate text;
  cleaned text;
  wanted_finish text;
begin
  if q ~* '\metched\s+foil\M' then
    wanted_finish := 'etched';
  elsif q ~* '\mnon[- ]?foil\M' or q ~* '\mnormal\M' or q ~* '\mregular\M' then
    wanted_finish := 'nonfoil';
  elsif q ~* '\mfoil\M' then
    wanted_finish := 'foil';
  end if;

  candidate := coalesce(
    nullif((regexp_match(q, '(?i)^show me (?:the )?(?:(?:etched\s+foil|non[- ]?foil|foil|normal|regular)\s+)?(?:price|market)\s+history\s+(?:for|of)\s+(.+?)\s*$'))[1], ''),
    nullif((regexp_match(q, '(?i)^(?:(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:show|give|find|get)\s+(?:me\s+)?)?(?:the\s+)?(?:(?:etched\s+foil|non[- ]?foil|foil|normal|regular)\s+)?(?:price|market)\s+history\s+(?:for|of)\s+(.+?)\s*$'))[1], ''),
    nullif((regexp_match(q, '(?i)^show me (.+?) (?:price|market|sales?|sale) history(?:\s|$)'))[1], ''),
    nullif((regexp_match(q, '(?i)^show me (.+?) over the (?:last|past)'))[1], ''),
    nullif((regexp_match(q, '(?i)^(?:graph|chart|plot|visualize|visualise) (?:the )?(?:price|market|sales?|sale)?\s*(?:history )?(?:for |of )?(.+?)(?:\s+(?:for|over|since)\b|$)'))[1], ''),
    nullif((regexp_match(q, '(?i)^how has (.+?) (?:sold|been selling|moved|performed)'))[1], ''),
    nullif((regexp_match(q, '(?i)^research (?:why )?(.+?) (?:is|was|has been) (?:moving|spiking|rising|up)'))[1], ''),
    nullif((regexp_match(q, '(?i)^research (.+?)$'))[1], ''),
    nullif((regexp_match(q, '(?i)^dig deeper (?:on|into) (.+?)$'))[1], ''),
    nullif((regexp_match(q, '(?i)^investigate (.+?)$'))[1], ''),
    nullif((regexp_match(q, '(?i)^why is (.+?) (?:moving|spiking|rising|up)\??$'))[1], ''),
    nullif((regexp_match(q, '(?i)^why did (.+?) (?:move|spike|jump|rise)\??$'))[1], ''),
    nullif((regexp_match(q, '(?i)^where is (.+?) seeing play\??$'))[1], ''),
    nullif((regexp_match(q, '(?i)^show me (.+?)(?: cards?)?\??$'))[1], ''),
    nullif((regexp_match(q, '(?i)^(.+?) cards?\??$'))[1], '')
  );

  if candidate is null and q !~ '[?]' and length(q) between 2 and 160 then
    candidate := q;
  end if;
  if candidate is null then return; end if;

  cleaned := trim(regexp_replace(candidate, '(?i)\s+cards?$', ''));
  cleaned := trim(regexp_replace(cleaned, '[?.!,]+$', ''));
  if cleaned = '' then return; end if;

  return query
  with matches as (
    select l.*,
           case
             when lower(l.card_name)=lower(cleaned) then 'exact'
             when lower(split_part(l.card_name,' // ',1))=lower(cleaned) then 'front_face_exact'
             when l.card_name ilike cleaned || '%' then 'prefix'
             else 'lookup'
           end as resolved_method,
           case
             when wanted_finish='etched' then case when lower(coalesce(l.printing,'')) like '%etched%' then 0 else 9 end
             when wanted_finish='foil' then case when lower(coalesce(l.printing,'')) like '%foil%' and lower(coalesce(l.printing,'')) not like '%non%foil%' and lower(coalesce(l.printing,'')) not like '%etched%' then 0 else 9 end
             when wanted_finish='nonfoil' then case when lower(coalesce(l.printing,'')) not like '%foil%' or lower(coalesce(l.printing,'')) like '%non%foil%' then 0 else 9 end
             else 0
           end as finish_rank
    from public.ask_collectish_public_card_lookup_v1(cleaned, 50) l
  )
  select m.card_name,
         nullif(m.product_id,'')::bigint,
         nullif(m.sku_id,'')::bigint,
         m.scryfall_id,
         m.set_code,
         m.collector_number,
         m.printing,
         m.condition,
         m.language,
         m.resolved_method
  from matches m
  where wanted_finish is null or m.finish_rank=0
  order by m.finish_rank,
           m.match_rank,
           case when upper(coalesce(m.condition,''))='NEAR MINT' then 0 else 1 end,
           case when upper(coalesce(m.language,''))='ENGLISH' then 0 else 1 end,
           m.sku_id
  limit 1;
end;
$function$;

revoke all on function public.ask_resolve_card_context(text) from public, anon;
grant execute on function public.ask_resolve_card_context(text) to authenticated, service_role;
