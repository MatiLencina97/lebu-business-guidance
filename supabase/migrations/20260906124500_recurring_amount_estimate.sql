alter table public.business_recurring_costs
  add column if not exists amount_is_estimate boolean not null default false;
