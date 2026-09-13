-- Misma protección que la migración anterior, expresada sin referenciar OLD en INSERT.
create or replace function public.lebu_guard_cash_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare caller_role text;
begin
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
