create extension if not exists pgcrypto;

create table if not exists public.diagrams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  diagram_type text not null check (diagram_type in ('er', 'logical', 'physical')),
  name text not null default '未命名圖表',
  content jsonb not null default '{}'::jsonb,
  linked_er_diagram_id uuid references public.diagrams(id) on delete set null,
  linked_lm_diagram_id uuid references public.diagrams(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists diagrams_set_updated_at on public.diagrams;
create trigger diagrams_set_updated_at
before update on public.diagrams
for each row execute function public.set_updated_at();

alter table public.diagrams enable row level security;

drop policy if exists "owners can read own diagrams" on public.diagrams;
create policy "owners can read own diagrams"
on public.diagrams for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "owners can insert own diagrams" on public.diagrams;
create policy "owners can insert own diagrams"
on public.diagrams for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "owners can update own diagrams" on public.diagrams;
create policy "owners can update own diagrams"
on public.diagrams for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "owners can delete own diagrams" on public.diagrams;
create policy "owners can delete own diagrams"
on public.diagrams for delete
to authenticated
using (auth.uid() = owner_id);

alter table public.diagrams replica identity full;
