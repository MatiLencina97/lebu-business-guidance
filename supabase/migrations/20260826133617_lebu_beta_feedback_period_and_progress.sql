-- Lebu 1.16 — Beta Feedback I
-- Retrocompatible: existing businesses keep calendar-month behavior and no aggregate starting progress.

alter table public.business_settings
  add column if not exists period_start_day smallint not null default 1;

alter table public.business_settings
  drop constraint if exists business_settings_period_start_day_check;

alter table public.business_settings
  add constraint business_settings_period_start_day_check
  check (period_start_day >= 1 and period_start_day <= 31);

comment on column public.business_settings.period_start_day is
  'Day of month when a custom monthly Lebu objective cycle starts. 1 means calendar month.';

alter table public.business_settings
  add column if not exists historical_summary jsonb;

comment on column public.business_settings.historical_summary is
  'Optional aggregate starting progress. Counts toward period totals but is excluded from day-level behavioral insights.';
