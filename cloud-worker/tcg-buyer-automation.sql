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

-- seller_monthly_buying_budget is replaced by the migration so inventory_purchase_spend
-- means automatic TCG buyer spend + the manual/off-platform adjustment stored in
-- seller_cashflow_monthly_inputs.inventory_purchase_spend.
