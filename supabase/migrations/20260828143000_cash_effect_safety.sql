-- Lebu 1.21.2 — invariantes de seguridad para impactos de caja.

alter table public.business_sales
  drop constraint if exists business_sales_cash_effect_bounds,
  add constraint business_sales_cash_effect_bounds check (
    cash_effect_amount is null
    or (cash_effect_amount >= 0 and cash_effect_amount <= amount)
  ),
  drop constraint if exists business_sales_cash_effect_pair,
  add constraint business_sales_cash_effect_pair check (
    (cash_effect_amount is null and cash_effect_at is null)
    or (cash_effect_amount is not null and cash_effect_at is not null)
  );

alter table public.business_expenses
  drop constraint if exists business_expenses_cash_effect_bounds,
  add constraint business_expenses_cash_effect_bounds check (
    cash_effect_amount is null
    or (cash_effect_amount <= 0 and abs(cash_effect_amount) <= amount)
  ),
  drop constraint if exists business_expenses_cash_effect_pair,
  add constraint business_expenses_cash_effect_pair check (
    (cash_effect_amount is null and cash_effect_at is null)
    or (cash_effect_amount is not null and cash_effect_at is not null)
  );

create or replace function public.lebu_guard_cash_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare caller_role text;
begin
  -- Service-role/backend writes do not carry an end-user auth.uid().
  if auth.uid() is null then return new; end if;
  caller_role := public.my_business_role(new.business_id);

  if tg_table_name = 'business_sales'
     and new.cash_effect_amount is not null
     and caller_role not in ('owner', 'admin') then
    if tg_op = 'INSERT' then
      raise exception 'Solo dueño o administrador puede confirmar un neto acreditado de venta';
    elsif new.cash_effect_amount is distinct from old.cash_effect_amount
       or new.cash_effect_at is distinct from old.cash_effect_at then
      raise exception 'Solo dueño o administrador puede confirmar un neto acreditado de venta';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists lebu_guard_cash_effects_sales on public.business_sales;
create trigger lebu_guard_cash_effects_sales
before insert or update on public.business_sales
for each row execute function public.lebu_guard_cash_effects();
