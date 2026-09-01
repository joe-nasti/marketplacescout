create or replace function public.service_hydrate_scout_edhrec_from_cache()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n_exact int; n_canonical int;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'service role required'; end if;

  with best as (
    select s.ctid rid,c.edhrec_rank,row_number() over(partition by s.ctid order by case when s.scryfall_id is not null and c.scryfall_id=s.scryfall_id::text then 0 else 1 end,c.observed_at desc) rn
    from public.scout_opportunities_24h s
    join public.edhrec_card_cache c on c.user_id=s.user_id and ((s.scryfall_id is not null and c.scryfall_id=s.scryfall_id::text) or (s.product_id is not null and c.product_id=s.product_id))
    where c.edhrec_rank is not null
  )
  update public.scout_opportunities_24h s set edhrec_rank=b.edhrec_rank from best b where s.ctid=b.rid and b.rn=1 and s.edhrec_rank is distinct from b.edhrec_rank;
  get diagnostics n_exact=row_count;

  with historical as (
    select
      m.user_id,
      lower(trim(regexp_replace(regexp_replace(m.product_name,'\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil|fracture foil)[^)]*\)\s*',' ','gi'),'\s+',' ','g'))) as oracle_name,
      m.edhrec_rank,
      m.edhrec_observed_at,
      row_number() over (
        partition by m.user_id, lower(trim(regexp_replace(regexp_replace(m.product_name,'\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil|fracture foil)[^)]*\)\s*',' ','gi'),'\s+',' ','g')))
        order by m.edhrec_observed_at desc nulls last
      ) rn
    from public.marketplace_scan_rows m
    where m.edhrec_rank is not null
  ), target as (
    select s.ctid rid,h.edhrec_rank
    from public.scout_opportunities_24h s
    join historical h
      on h.user_id=s.user_id
     and h.rn=1
     and h.oracle_name=lower(trim(regexp_replace(regexp_replace(s.product_name,'\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil|fracture foil)[^)]*\)\s*',' ','gi'),'\s+',' ','g')))
    where s.edhrec_rank is distinct from h.edhrec_rank
  )
  update public.scout_opportunities_24h s
     set edhrec_rank=t.edhrec_rank
    from target t
   where s.ctid=t.rid;
  get diagnostics n_canonical=row_count;

  perform public.refresh_scout_opportunities_v5_cache();
  return jsonb_build_object('updated_exact_rows',n_exact,'updated_canonical_rows',n_canonical);
end
$function$;
