create or replace function public.resolve_delvin_shared_query_v1(p_question text, p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path='public' as $function$
declare
  q text := lower(regexp_replace(trim(coalesce(p_question,'')), '[^a-zA-Z0-9]+', ' ', 'g'));
  r public.delvin_query_registry%rowtype;
  c jsonb;
  treatment text;
  setcode text;
  setcodes text[];
  card text;
begin
  q := trim(regexp_replace(q,'\s+',' ','g'));
  if q='' then return jsonb_build_object('handled',false); end if;

  select * into r from public.delvin_query_registry d
  where d.enabled and (
    trim(lower(regexp_replace(d.prompt,'[^a-zA-Z0-9]+',' ','g')))=q
    or exists(select 1 from unnest(d.aliases) a where trim(lower(regexp_replace(a,'[^a-zA-Z0-9]+',' ','g')))=q)
    or exists(select 1 from unnest(d.aliases) a where length(trim(regexp_replace(a,'[^a-zA-Z0-9]+',' ','g')))>=8 and q like '%'||trim(lower(regexp_replace(a,'[^a-zA-Z0-9]+',' ','g')))||'%')
  ) order by d.sort_order,d.query_key limit 1;
  if found then
    c:=public.get_delvin_query_cache_v1(r.query_key);
    return jsonb_build_object('handled',true,'route','delvin_query_cache','query_key',r.query_key,'prompt',r.prompt,'category',r.category,'payload',c,'followups',r.followups,'surface_type','delvin_query','source','shared_registry_cache');
  end if;

  treatment := case
    when q like '%textured foil%' then 'Textured Foil' when q like '%serialized%' then 'Serialized'
    when q like '%raised foil%' then 'Raised Foil' when q like '%fracture foil%' then 'Fracture Foil'
    when q like '%confetti foil%' then 'Confetti Foil' when q like '%galaxy foil%' then 'Galaxy Foil'
    when q like '%surge foil%' then 'Surge Foil' when q like '%rainbow foil%' then 'Rainbow Foil'
    when q like '%halo foil%' then 'Halo Foil' when q like '%oil slick%' then 'Oil Slick Raised Foil'
    when q like '%step and compleat%' then 'Step-and-Compleat Foil' when q like '%neon ink%' then 'Neon Ink'
    when q like '%gilded foil%' then 'Gilded Foil' when q like '%etched foil%' then 'Etched Foil'
    when q like '%retro frame foil%' then 'Retro Frame Foil' when q like '%borderless foil%' then 'Borderless Foil'
    when q like '%showcase foil%' then 'Showcase Foil' when q like '%extended art foil%' then 'Extended Art Foil'
    else null end;

  select array_agg(code order by ord) into setcodes
  from (
    select distinct on (upper(m[1])) upper(m[1]) code, min(ord) over(partition by upper(m[1])) ord
    from regexp_matches(upper(coalesce(p_question,'')),'\m([A-Z0-9]{3,6})\M','g') with ordinality as x(m,ord)
    where exists(select 1 from public.scout_opportunities_v5_cache s where upper(s.set_code)=upper(m[1]))
    order by upper(m[1]),ord
  ) z;
  setcode:=setcodes[1];

  if treatment is not null and q ~ '(growth|upside|room to grow|growth left|still grow|more room|more upside|plateau|ceiling|run left|legs left|runway|long term|long-term|collectible thesis)' then
    return jsonb_build_object('handled',true,'route','collectible_cohort_thesis','surface_type','collectible_cohort_thesis','set_codes',setcodes,'treatment',treatment,
      'payload',public.ask_delvin_collectible_cohort_thesis_v1(treatment,setcodes,365),'source','shared_deterministic_rpc');
  end if;

  if treatment is not null and (q ~ '(across sets|cross set|which sets|best sets|compare sets|treatment families|treatment family)' or coalesce(array_length(setcodes,1),0)=0) then
    return jsonb_build_object('handled',true,'route','collectible_family_index','surface_type','collectible_family_index','treatment',treatment,
      'payload',public.ask_delvin_collectible_family_index_v1(treatment,least(greatest(coalesce(p_limit,30),1),100)),'source','shared_deterministic_rpc');
  end if;

  if setcode is not null and q ~ '(set|cards|treatment|foil|collector|market|doing|opportunit|moving|movers)' then
    if treatment is not null then
      return jsonb_build_object('handled',true,'route','set_treatment_intelligence','surface_type','set_treatment_intelligence','set_code',setcode,'treatment',treatment,
        'payload',public.ask_delvin_treatment_intelligence_v1(setcode,treatment,least(greatest(coalesce(p_limit,30),1),100)),'source','shared_deterministic_rpc');
    end if;
    return jsonb_build_object('handled',true,'route','set_intelligence','surface_type','set_intelligence','set_code',setcode,
      'payload',public.ask_delvin_set_intelligence_v1(setcode,least(greatest(coalesce(p_limit,30),1),100)),'source','shared_deterministic_rpc');
  end if;

  if q like 'investigate %' or q like 'deep dive %' then
    card:=trim(regexp_replace(coalesce(p_question,''),'^(investigate|deep dive)\s+','','i'));
    if card<>'' then return jsonb_build_object('handled',true,'route','card_investigation','surface_type','card_investigation','card_name',card,'payload',public.ask_delvin_card_investigation_v1(card),'source','shared_deterministic_rpc'); end if;
  end if;
  if q like 'all printings of %' or q like 'printing family %' then
    card:=trim(regexp_replace(coalesce(p_question,''),'^(all printings of|printing family)\s+','','i'));
    if card<>'' then return jsonb_build_object('handled',true,'route','printing_family','surface_type','printing_family','card_name',card,'payload',public.ask_delvin_printing_family_v1(card,least(greatest(coalesce(p_limit,30),1),100)),'source','shared_deterministic_rpc'); end if;
  end if;
  return jsonb_build_object('handled',false);
end
$function$;

revoke all on function public.resolve_delvin_shared_query_v1(text,integer) from public,anon;
grant execute on function public.resolve_delvin_shared_query_v1(text,integer) to authenticated,service_role;