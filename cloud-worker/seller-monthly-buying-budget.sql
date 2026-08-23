create table if not exists public.seller_cashflow_monthly_inputs (
  user_id uuid not null,
  month_start date not null,
  inventory_purchase_spend numeric not null default 0 check (inventory_purchase_spend>=0),
  operating_expense_spend numeric not null default 0 check (operating_expense_spend>=0),
  reserve_pct numeric not null default 15 check (reserve_pct between 0 and 100),
  purchase_target_pct numeric not null default 70 check (purchase_target_pct between 0 and 150),
  note text,
  updated_at timestamptz not null default now(),
  primary key(user_id,month_start)
);
alter table public.seller_cashflow_monthly_inputs enable row level security;
create policy seller_cashflow_monthly_inputs_select on public.seller_cashflow_monthly_inputs for select to authenticated using ((select auth.uid())=user_id);
create policy seller_cashflow_monthly_inputs_insert on public.seller_cashflow_monthly_inputs for insert to authenticated with check ((select auth.uid())=user_id);
create policy seller_cashflow_monthly_inputs_update on public.seller_cashflow_monthly_inputs for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.seller_cashflow_monthly_inputs from anon;
grant select,insert,update on public.seller_cashflow_monthly_inputs to authenticated;

create or replace function public.save_seller_cashflow_month(
  p_month_start date,p_inventory_purchase_spend numeric,p_operating_expense_spend numeric,
  p_reserve_pct numeric default 15,p_purchase_target_pct numeric default 70,p_note text default null
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into public.seller_cashflow_monthly_inputs(user_id,month_start,inventory_purchase_spend,operating_expense_spend,reserve_pct,purchase_target_pct,note,updated_at)
  values(auth.uid(),date_trunc('month',p_month_start)::date,greatest(0,coalesce(p_inventory_purchase_spend,0)),greatest(0,coalesce(p_operating_expense_spend,0)),greatest(0,least(100,coalesce(p_reserve_pct,15))),greatest(0,least(150,coalesce(p_purchase_target_pct,70))),p_note,now())
  on conflict(user_id,month_start) do update set inventory_purchase_spend=excluded.inventory_purchase_spend,operating_expense_spend=excluded.operating_expense_spend,reserve_pct=excluded.reserve_pct,purchase_target_pct=excluded.purchase_target_pct,note=excluded.note,updated_at=now();
end $$;
revoke all on function public.save_seller_cashflow_month(date,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.save_seller_cashflow_month(date,numeric,numeric,numeric,numeric,text) to authenticated;

create or replace function public.seller_monthly_buying_budget(p_month_start date default current_date)
returns table(
  month_start date,posted_marketplace_cash numeric,pending_marketplace_cash numeric,trailing_3mo_avg_cash numeric,benchmark_monthly_cash numeric,
  inventory_purchase_spend numeric,operating_expense_spend numeric,known_total_spend numeric,reserve_pct numeric,reserve_amount numeric,purchase_target_pct numeric,purchase_target_amount numeric,
  purchase_room_vs_target numeric,net_cash_after_known_spend numeric,safe_additional_buy_budget numeric,current_inventory_cost_basis numeric,current_inventory_list_value numeric,input_status text,note text
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
    where p.user_id=auth.uid() and not coalesce(p.is_pending,false) and p.arrival_date>=x.m-interval '3 months' and p.arrival_date<x.m group by 1
  ) q
), inp as (
  select coalesce(i.inventory_purchase_spend,0)::numeric inv_spend,coalesce(i.operating_expense_spend,0)::numeric op_spend,
         coalesce(i.reserve_pct,15)::numeric reserve_pct,coalesce(i.purchase_target_pct,70)::numeric target_pct,i.note,(i.user_id is not null) has_input
  from params x left join public.seller_cashflow_monthly_inputs i on i.user_id=auth.uid() and i.month_start=x.m
), inventory as (
  select coalesce(sum(coalesce(quantity,0)*coalesce(acquisition_cost,0)),0)::numeric cost_basis,coalesce(sum(coalesce(quantity,0)*coalesce(list_price,0)),0)::numeric list_value
  from public.collectish_inventory_positions where user_id=auth.uid()
), calc as (
  select x.m,c.posted,c.pending,p.avg3,i.inv_spend,i.op_spend,i.reserve_pct,i.target_pct,i.note,i.has_input,inv.cost_basis,inv.list_value,
         greatest(c.posted,p.avg3)::numeric benchmark,(i.inv_spend+i.op_spend)::numeric known_spend
  from params x cross join current_cash c cross join prior p cross join inp i cross join inventory inv
)
select m,round(posted,2),round(pending,2),round(avg3,2),round(benchmark,2),round(inv_spend,2),round(op_spend,2),round(known_spend,2),
       reserve_pct,round(posted*reserve_pct/100.0,2),target_pct,round(benchmark*target_pct/100.0,2),round(greatest(0,benchmark*target_pct/100.0-inv_spend),2),
       round(posted-known_spend,2),round(greatest(0,least(greatest(0,benchmark*target_pct/100.0-inv_spend),greatest(0,posted-known_spend-(posted*reserve_pct/100.0)))),2),
       round(cost_basis,2),round(list_value,2),case when has_input then 'entered' else 'needs_spend_input' end,note
from calc;
$$;
revoke all on function public.seller_monthly_buying_budget(date) from public,anon;
grant execute on function public.seller_monthly_buying_budget(date) to authenticated;
