-- Lebu 1.23.3 — harden SECURITY DEFINER helper search paths.

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.business_members
    where business_id = target_business_id
      and user_id = auth.uid()
  );
$function$;

create or replace function public.get_or_create_my_business()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  uid uuid := auth.uid();
  bid uuid;
  legacy_rev bigint := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select business_id into bid
  from public.business_members
  where user_id = uid
  order by created_at asc
  limit 1;

  if bid is not null then
    select coalesce(revision,0) into legacy_rev
    from public.business_state
    where business_id = bid;

    insert into public.business_settings (business_id, updated_by, legacy_revision)
    values (bid, uid, coalesce(legacy_rev,0))
    on conflict (business_id) do nothing;

    return bid;
  end if;

  insert into public.businesses (created_by)
  values (uid)
  returning id into bid;

  insert into public.business_members (business_id, user_id, role)
  values (bid, uid, 'owner');

  insert into public.business_state (business_id, state, revision, updated_by)
  values (bid, '{}'::jsonb, 0, uid);

  insert into public.business_settings (business_id, updated_by, legacy_revision)
  values (bid, uid, 0);

  return bid;
end;
$function$;

revoke execute on function public.is_business_member(uuid) from PUBLIC, anon;
revoke execute on function public.get_or_create_my_business() from PUBLIC, anon;
grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.get_or_create_my_business() to authenticated;
