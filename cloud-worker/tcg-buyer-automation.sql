-- TCGplayer buyer account automation.
-- HAR files are parsed client-side; only normalized order/item data reaches Postgres.

create table if not exists public.tcg_buyer_orders (
  user_id uuid not null,
  order_number text not null,
  order_date timestamptz not null,
  subtotal numeric,
  shipping_amount numeric,
  tax_amount numeric,
  total_amount numeric not null check (total_amount >= 0),
  status text,
  payment_method text,
  source text not null default 'tcgplayer_har',
  source_path text,
  imported_at timestamptz not null default now(),
  primary key (user_id, order_number)
);
alter table public.tcg_buyer_orders enable row level security;
create policy tcg_buyer_orders_select on public.tcg_buyer_orders for select to authenticated using ((select auth.uid())=user_id);
create policy tcg_buyer_orders_insert on public.tcg_buyer_orders for insert to authenticated with check ((select auth.uid())=user_id);
create policy tcg_buyer_orders_update on public.tcg_buyer_orders for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.tcg_buyer_orders from anon;
grant select,insert,update on public.tcg_buyer_orders to authenticated;

create table if not exists public.tcg_buyer_order_items (
  user_id uuid not null,
  order_number text not null,
  line_key text not null,
  product_id text,
  sku_id text,
  product_name text,
  set_name text,
  condition text,
  printing text,
  seller_name text,
  quantity numeric not null default 1 check (quantity >= 0),
  unit_price numeric,
  line_total numeric,
  imported_at timestamptz not null default now(),
  primary key (user_id, order_number, line_key),
  foreign key (user_id, order_number) references public.tcg_buyer_orders(user_id, order_number) on delete cascade
);
alter table public.tcg_buyer_order_items enable row level security;
create policy tcg_buyer_order_items_select on public.tcg_buyer_order_items for select to authenticated using ((select auth.uid())=user_id);
create policy tcg_buyer_order_items_insert on public.tcg_buyer_order_items for insert to authenticated with check ((select auth.uid())=user_id);
create policy tcg_buyer_order_items_update on public.tcg_buyer_order_items for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy tcg_buyer_order_items_delete on public.tcg_buyer_order_items for delete to authenticated using ((select auth.uid())=user_id);
revoke all on public.tcg_buyer_order_items from anon;
grant select,insert,update,delete on public.tcg_buyer_order_items to authenticated;
create index if not exists tcg_buyer_orders_user_date_idx on public.tcg_buyer_orders(user_id,order_date desc);
create index if not exists tcg_buyer_items_user_product_idx on public.tcg_buyer_order_items(user_id,product_id) where product_id is not null;

create or replace function public.import_tcg_buyer_orders(p_orders jsonb)
returns table(imported_orders integer, imported_items integer, min_order_date timestamptz, max_order_date timestamptz)
language plpgsql security invoker set search_path=public as $$
declare
  o jsonb; it jsonb; n_orders integer:=0; n_items integer:=0; ord text; d timestamptz; tot numeric; lk text; idx integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(p_orders) <> 'array' then raise exception 'orders must be an array'; end if;
  if jsonb_array_length(p_orders) > 1000 then raise exception 'too many orders in one import'; end if;
  for o in select value from jsonb_array_elements(p_orders)
  loop
    ord:=nullif(trim(o->>'order_number'),'');
    begin d:=(o->>'order_date')::timestamptz; exception when others then d:=null; end;
    begin tot:=greatest(0,coalesce((o->>'total_amount')::numeric,0)); exception when others then tot:=0; end;
    if ord is null or d is null then continue; end if;
    insert into public.tcg_buyer_orders(user_id,order_number,order_date,subtotal,shipping_amount,tax_amount,total_amount,status,payment_method,source,source_path,imported_at)
    values(auth.uid(),ord,d,nullif(o->>'subtotal','')::numeric,nullif(o->>'shipping_amount','')::numeric,nullif(o->>'tax_amount','')::numeric,tot,nullif(o->>'status',''),nullif(o->>'payment_method',''),'tcgplayer_har',left(nullif(o->>'source_path',''),500),now())
    on conflict(user_id,order_number) do update set order_date=excluded.order_date,subtotal=excluded.subtotal,shipping_amount=excluded.shipping_amount,tax_amount=excluded.tax_amount,total_amount=excluded.total_amount,status=excluded.status,payment_method=excluded.payment_method,source_path=excluded.source_path,imported_at=now();
    n_orders:=n_orders+1;
    delete from public.tcg_buyer_order_items where user_id=auth.uid() and order_number=ord;
    idx:=0;
    if jsonb_typeof(o->'items')='array' then
      for it in select value from jsonb_array_elements(o->'items')
      loop
        idx:=idx+1;
        lk:=coalesce(nullif(it->>'line_key',''),nullif(it->>'sku_id',''),nullif(it->>'product_id',''),idx::text)||':'||idx::text;
        insert into public.tcg_buyer_order_items(user_id,order_number,line_key,product_id,sku_id,product_name,set_name,condition,printing,seller_name,quantity,unit_price,line_total,imported_at)
        values(auth.uid(),ord,lk,nullif(it->>'product_id',''),nullif(it->>'sku_id',''),left(nullif(it->>'product_name',''),500),left(nullif(it->>'set_name',''),300),left(nullif(it->>'condition',''),100),left(nullif(it->>'printing',''),100),left(nullif(it->>'seller_name',''),300),greatest(0,coalesce(nullif(it->>'quantity','')::numeric,1)),nullif(it->>'unit_price','')::numeric,nullif(it->>'line_total','')::numeric,now());
        n_items:=n_items+1;
      end loop;
    end if;
  end loop;
  return query select n_orders,n_items,min(order_date),max(order_date) from public.tcg_buyer_orders where user_id=auth.uid();
end $$;
revoke all on function public.import_tcg_buyer_orders(jsonb) from public,anon;
grant execute on function public.import_tcg_buyer_orders(jsonb) to authenticated;

drop function if exists public.seller_monthly_buying_budget(date);
create function public.seller_monthly_buying_budget(p_month_start date default current_date)
returns table(
  month_start date,posted_marketplace_cash numeric,pending_marketplace_cash numeric,trailing_3mo_avg_cash numeric,benchmark_monthly_cash numeric,
  tcg_buyer_purchase_spend numeric,manual_purchase_adjustment numeric,inventory_purchase_spend numeric,operating_expense_spend numeric,known_total_spend numeric,
  reserve_pct numeric,reserve_amount numeric,purchase_target_pct numeric,purchase_target_amount numeric,purchase_room_vs_target numeric,net_cash_after_known_spend numeric,
  safe_additional_buy_budget numeric,current_inventory_cost_basis numeric,current_inventory_list_value numeric,input_status text,buyer_orders_count bigint,note text
)
language sql security invoker set search_path=public as $$
with params as (select date_trunc('month',coalesce(p_month_start,current_date))::date m),
current_cash as (
  select coalesce(sum(payment) filter(where not coalesce(is_pending,false) and arrival_date<=now()),0)::numeric posted,
         coalesce(sum(payment) filter(where coalesce(is_pending,false) or arrival_date>now()),0)::numeric pending
  from public.seller_payments p,params x where p.user_id=auth.uid() and p.arrival_date>=x.m and p.arrival_date<x.m+interval '1 month'
), prior as (
  select coalesce(avg(month_cash),0)::numeric avg3 from (
    select date_trunc('month',p.arrival_date) mon,sum(p.payment)::numeric month_cash
    from public.seller_payments p,params x
    where p.user_id=auth.uid() and not coalesce(p.is_pending,false) and p.arrival_date<=now() and p.arrival_date>=x.m-interval '3 months' and p.arrival_date<x.m group by 1
  ) q
), buyer as (
  select coalesce(sum(total_amount) filter(where lower(coalesce(status,'')) !~ '(cancel|void|refund(ed)?$)'),0)::numeric buyer_spend,
         count(*) filter(where lower(coalesce(status,'')) !~ '(cancel|void|refund(ed)?$)')::bigint order_count
  from public.tcg_buyer_orders o,params x where o.user_id=auth.uid() and o.order_date>=x.m and o.order_date<x.m+interval '1 month'
), inp as (
  select coalesce(i.inventory_purchase_spend,0)::numeric manual_adj,coalesce(i.operating_expense_spend,0)::numeric op_spend,
         coalesce(i.reserve_pct,15)::numeric reserve_pct,coalesce(i.purchase_target_pct,70)::numeric target_pct,i.note,(i.user_id is not null) has_input
  from params x left join public.seller_cashflow_monthly_inputs i on i.user_id=auth.uid() and i.month_start=x.m
), inventory as (
  select coalesce(sum(coalesce(quantity,0)*coalesce(acquisition_cost,0)),0)::numeric cost_basis,coalesce(sum(coalesce(quantity,0)*coalesce(list_price,0)),0)::numeric list_value
  from public.collectish_inventory_positions where user_id=auth.uid()
), calc as (
  select x.m,c.posted,c.pending,p.avg3,b.buyer_spend,b.order_count,i.manual_adj,i.op_spend,i.reserve_pct,i.target_pct,i.note,i.has_input,inv.cost_basis,inv.list_value,
         greatest(c.posted,p.avg3)::numeric benchmark,(b.buyer_spend+i.manual_adj)::numeric inv_spend,(b.buyer_spend+i.manual_adj+i.op_spend)::numeric known_spend
  from params x cross join current_cash c cross join prior p cross join buyer b cross join inp i cross join inventory inv
)
select m,round(posted,2),round(pending,2),round(avg3,2),round(benchmark,2),round(buyer_spend,2),round(manual_adj,2),round(inv_spend,2),round(op_spend,2),round(known_spend,2),
       reserve_pct,round(posted*reserve_pct/100.0,2),target_pct,round(benchmark*target_pct/100.0,2),round(greatest(0,benchmark*target_pct/100.0-inv_spend),2),
       round(posted-known_spend,2),round(greatest(0,least(greatest(0,benchmark*target_pct/100.0-inv_spend),greatest(0,posted-known_spend-(posted*reserve_pct/100.0)))),2),
       round(cost_basis,2),round(list_value,2),case when has_input and order_count>0 then 'auto_plus_manual' when has_input then 'manual_only' when order_count>0 then 'auto_buyer_only' else 'needs_spend_input' end,
       order_count,note
from calc;
$$;
revoke all on function public.seller_monthly_buying_budget(date) from public,anon;
grant execute on function public.seller_monthly_buying_budget(date) to authenticated;
