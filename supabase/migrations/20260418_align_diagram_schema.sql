create extension if not exists pgcrypto;

-- Align existing diagrams table with the new schema while preserving data.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'diagrams'
      and column_name = 'owner_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'diagrams'
      and column_name = 'user_id'
  ) then
    alter table public.diagrams rename column owner_id to user_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'diagrams'
      and column_name = 'diagram_type'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'diagrams'
      and column_name = 'type'
  ) then
    alter table public.diagrams rename column diagram_type to type;
  end if;
end $$;

create table if not exists public.diagrams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text not null,
  type text check (type in ('er', 'logical', 'physical')),
  deleted_at timestamptz default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.diagrams
  alter column name set not null;

alter table public.diagrams
  alter column type type text;

alter table public.diagrams
  alter column type drop default;

alter table public.diagrams
  drop constraint if exists diagrams_type_check;

alter table public.diagrams
  add constraint diagrams_type_check check (type in ('er', 'logical', 'physical'));

alter table public.diagrams
  alter column deleted_at drop not null;

alter table public.diagrams
  alter column deleted_at set default null;

alter table public.diagrams
  alter column created_at set default now();

alter table public.diagrams
  alter column updated_at set default now();

create table if not exists public.er_nodes (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid references public.diagrams(id) on delete cascade,
  type text check (type in ('entity', 'attribute', 'relationship', 'er_entity')),
  label text default '',
  x float,
  y float,
  width float default 120,
  height float default 60,
  is_primary_key boolean default false,
  font_size int default 14,
  font_bold boolean default false,
  font_underline boolean default false,
  style jsonb default '{}'::jsonb
);

create table if not exists public.er_edges (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid references public.diagrams(id) on delete cascade,
  source_id uuid references public.er_nodes(id),
  target_id uuid references public.er_nodes(id),
  label text default ''
);

create table if not exists public.logical_tables (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid references public.diagrams(id) on delete cascade,
  name text not null,
  x float default 100,
  y float default 100
);

create table if not exists public.logical_fields (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references public.logical_tables(id) on delete cascade,
  name text not null,
  order_index int not null,
  is_pk boolean default false,
  is_fk boolean default false,
  is_multi_value boolean default false,
  is_composite boolean default false,
  composite_children text[] default '{}'::text[],
  partial_dep_on text[] default '{}'::text[],
  transitive_dep_via text default null,
  fk_ref_table text default null,
  fk_ref_field text default null
);

create table if not exists public.logical_edges (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid references public.diagrams(id) on delete cascade,
  source_table_id uuid references public.logical_tables(id),
  source_field_id uuid references public.logical_fields(id),
  target_table_id uuid references public.logical_tables(id),
  target_field_id uuid references public.logical_fields(id),
  edge_type text default 'fk'
);
