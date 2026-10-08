-- Lebu 1.23.3 — split write policies so SELECT only evaluates the dedicated membership policy.

drop policy if exists production_days_write on public.business_production_days;
create policy production_days_insert on public.business_production_days for insert to authenticated
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy production_days_update on public.business_production_days for update to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]))
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy production_days_delete on public.business_production_days for delete to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));

drop policy if exists production_events_write on public.business_production_events;
create policy production_events_insert on public.business_production_events for insert to authenticated
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy production_events_update on public.business_production_events for update to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]))
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy production_events_delete on public.business_production_events for delete to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));

drop policy if exists production_products_write on public.business_production_products;
create policy production_products_insert on public.business_production_products for insert to authenticated
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy production_products_update on public.business_production_products for update to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]))
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy production_products_delete on public.business_production_products for delete to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));

drop policy if exists environment_events_write on public.business_environment_events;
create policy environment_events_insert on public.business_environment_events for insert to authenticated
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy environment_events_update on public.business_environment_events for update to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]))
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy environment_events_delete on public.business_environment_events for delete to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));

drop policy if exists environment_settings_write on public.business_environment_settings;
create policy environment_settings_insert on public.business_environment_settings for insert to authenticated
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]));
create policy environment_settings_update on public.business_environment_settings for update to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]))
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]));
create policy environment_settings_delete on public.business_environment_settings for delete to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]));

drop policy if exists weather_days_write on public.business_weather_days;
create policy weather_days_insert on public.business_weather_days for insert to authenticated
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy weather_days_update on public.business_weather_days for update to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]))
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));
create policy weather_days_delete on public.business_weather_days for delete to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text,'operator'::text,'loader'::text]));

drop policy if exists weather_settings_write on public.business_weather_settings;
create policy weather_settings_insert on public.business_weather_settings for insert to authenticated
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]));
create policy weather_settings_update on public.business_weather_settings for update to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]))
with check (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]));
create policy weather_settings_delete on public.business_weather_settings for delete to authenticated
using (public.my_business_role(business_id) = any (array['owner'::text,'admin'::text]));
