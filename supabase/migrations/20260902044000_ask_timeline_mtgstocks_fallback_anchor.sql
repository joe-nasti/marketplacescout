create or replace function public.ask_collectish_market_timeline_v1(p_product_id text default null::text, p_sku_id text default null::text, p_days integer default 120)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  h jsonb;
  card jsonb;
  ev jsonb;
  fallback_row record;
  fallback_pct numeric;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  p_days:=greatest(30,least(coalesce(p_days,120),365));
  h:=public.ask_card_price_history_v1(nullif(p_product_id,'')::bigint,nullif(p_sku_id,'')::bigint,p_days);
  if not coalesce((h->>'available')::boolean,false) then
    return jsonb_build_object('available',false,'reason','shared exact-sku history unavailable');
  end if;
  card:=coalesce(h->'card','{}'::jsonb);

  with p as (
    select (x->>'observed_at')::timestamptz observed_at,
           (x->>'market_price')::numeric market_price,
           lag((x->>'market_price')::numeric) over(order by (x->>'observed_at')::timestamptz) prev_market
    from jsonb_array_elements(coalesce(h->'price_points','[]'::jsonb)) x
    where nullif(x->>'observed_at','') is not null and nullif(x->>'market_price','') is not null
  ), moved as (
    select observed_at,'price'::text kind,'Market repriced'::text title,
      format('Market $%s → $%s (%s%s%%)',round(prev_market,2),round(market_price,2),case when market_price>=prev_market then '+' else '' end,round(((market_price-prev_market)/nullif(prev_market,0))*100,1)) detail,
      abs(((market_price-prev_market)/nullif(prev_market,0))*100)::numeric significance,
      jsonb_build_object('from',prev_market,'to',market_price,'change_pct',round(((market_price-prev_market)/nullif(prev_market,0))*100,1),'source','tcgplayer_official_sku_price_history') data
    from p
    where prev_market>0 and market_price>0 and abs((market_price-prev_market)/prev_market)>=0.05
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_at',observed_at,'kind',kind,'title',title,'detail',detail,'significance',round(significance,1),'data',data) order by observed_at),'[]'::jsonb)
  into ev
  from moved;

  if jsonb_array_length(coalesce(ev,'[]'::jsonb))=0 then
    select i.observed_at,i.title,i.summary
      into fallback_row
    from public.market_intel_items i
    where i.source_name='MTGStocks'
      and i.observed_at>=now()-interval '21 days'
      and (
        i.title ilike '%'||coalesce(nullif(split_part(card->>'card_name',' // ',1),''),card->>'card_name')||'%'
        or i.summary ilike '%'||coalesce(nullif(split_part(card->>'card_name',' // ',1),''),card->>'card_name')||'%'
      )
    order by i.observed_at asc
    limit 1;

    if fallback_row.observed_at is not null then
      begin
        fallback_pct:=nullif((regexp_match(coalesce(fallback_row.summary,''),'\(([+-]?[0-9.]+)%\)'))[1],'')::numeric;
      exception when others then fallback_pct:=null;
      end;
      ev:=jsonb_build_array(jsonb_build_object(
        'event_at',fallback_row.observed_at,
        'kind','price',
        'title','MTGStocks move detected',
        'detail',coalesce(fallback_row.summary,fallback_row.title),
        'significance',coalesce(abs(fallback_pct),25),
        'data',jsonb_build_object('source','MTGStocks','change_pct',fallback_pct,'fallback_anchor',true)
      ));
    end if;
  end if;

  return jsonb_build_object(
    'available',true,
    'version','v3_shared_history_mtgstocks_anchor',
    'days',p_days,
    'card',jsonb_build_object('product_id',card->>'product_id','sku_id',card->>'sku_id','product_name',card->>'card_name','set_name',card->>'set_code'),
    'events',coalesce(ev,'[]'::jsonb),
    'event_count',jsonb_array_length(coalesce(ev,'[]'::jsonb)),
    'identity_source','ask_card_price_history_v1',
    'generated_at',now()
  );
end
$function$;
