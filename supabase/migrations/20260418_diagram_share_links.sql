create extension if not exists pgcrypto;

create table if not exists public.diagram_shares (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid not null references public.diagrams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  token text not null unique,
  permission text not null check (permission in ('viewer', 'editor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (diagram_id, permission)
);

alter table public.diagram_shares enable row level security;

drop policy if exists "diagram_shares_select_own" on public.diagram_shares;
drop policy if exists "diagram_shares_insert_own" on public.diagram_shares;
drop policy if exists "diagram_shares_update_own" on public.diagram_shares;
drop policy if exists "diagram_shares_delete_own" on public.diagram_shares;

create policy "diagram_shares_select_own"
on public.diagram_shares
for select
to authenticated
using (
  exists (
    select 1 from public.diagrams d
    where d.id = diagram_shares.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "diagram_shares_insert_own"
on public.diagram_shares
for insert
to authenticated
with check (
  exists (
    select 1 from public.diagrams d
    where d.id = diagram_shares.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "diagram_shares_update_own"
on public.diagram_shares
for update
to authenticated
using (
  exists (
    select 1 from public.diagrams d
    where d.id = diagram_shares.diagram_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.diagrams d
    where d.id = diagram_shares.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "diagram_shares_delete_own"
on public.diagram_shares
for delete
to authenticated
using (
  exists (
    select 1 from public.diagrams d
    where d.id = diagram_shares.diagram_id
      and d.user_id = auth.uid()
  )
);

create or replace function public.upsert_diagram_share(
  p_diagram_id uuid,
  p_permission text default 'editor'
)
returns table(token text, permission text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.diagrams d
    where d.id = p_diagram_id
      and d.user_id = v_uid
  ) then
    raise exception 'permission denied';
  end if;

  if p_permission not in ('viewer', 'editor') then
    raise exception 'invalid permission';
  end if;

  return query
  insert into public.diagram_shares (diagram_id, created_by, token, permission, is_active, updated_at)
  values (
    p_diagram_id,
    v_uid,
    encode(gen_random_bytes(16), 'hex'),
    p_permission,
    true,
    now()
  )
  on conflict (diagram_id, permission)
  do update set updated_at = now(), is_active = true
  returning diagram_shares.token, diagram_shares.permission;
end;
$$;

create or replace function public.resolve_diagram_share(
  p_token text
)
returns table(
  diagram_id uuid,
  diagram_type text,
  permission text,
  name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select d.id, d.type, s.permission, d.name
  from public.diagram_shares s
  join public.diagrams d on d.id = s.diagram_id
  where s.token = p_token
    and s.is_active = true
    and d.deleted_at is null
  limit 1;
end;
$$;

grant execute on function public.upsert_diagram_share(uuid, text) to authenticated;
grant execute on function public.resolve_diagram_share(text) to anon, authenticated;
