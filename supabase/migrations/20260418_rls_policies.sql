-- Row Level Security policies for all diagram tables.
-- Scope: authenticated users can only access their own diagram data.

alter table public.diagrams enable row level security;
alter table public.er_nodes enable row level security;
alter table public.er_edges enable row level security;
alter table public.logical_tables enable row level security;
alter table public.logical_fields enable row level security;
alter table public.logical_edges enable row level security;

-- diagrams
drop policy if exists "owners can read own diagrams" on public.diagrams;
drop policy if exists "owners can insert own diagrams" on public.diagrams;
drop policy if exists "owners can update own diagrams" on public.diagrams;
drop policy if exists "owners can delete own diagrams" on public.diagrams;
drop policy if exists "diagrams_select_own" on public.diagrams;
drop policy if exists "diagrams_insert_own" on public.diagrams;
drop policy if exists "diagrams_update_own" on public.diagrams;
drop policy if exists "diagrams_delete_own" on public.diagrams;

create policy "diagrams_select_own"
on public.diagrams
for select
to authenticated
using (auth.uid() = user_id);

create policy "diagrams_insert_own"
on public.diagrams
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "diagrams_update_own"
on public.diagrams
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "diagrams_delete_own"
on public.diagrams
for delete
to authenticated
using (auth.uid() = user_id);

-- er_nodes
drop policy if exists "er_nodes_select_own" on public.er_nodes;
drop policy if exists "er_nodes_insert_own" on public.er_nodes;
drop policy if exists "er_nodes_update_own" on public.er_nodes;
drop policy if exists "er_nodes_delete_own" on public.er_nodes;

create policy "er_nodes_select_own"
on public.er_nodes
for select
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_nodes.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "er_nodes_insert_own"
on public.er_nodes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_nodes.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "er_nodes_update_own"
on public.er_nodes
for update
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_nodes.diagram_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_nodes.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "er_nodes_delete_own"
on public.er_nodes
for delete
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_nodes.diagram_id
      and d.user_id = auth.uid()
  )
);

-- er_edges
drop policy if exists "er_edges_select_own" on public.er_edges;
drop policy if exists "er_edges_insert_own" on public.er_edges;
drop policy if exists "er_edges_update_own" on public.er_edges;
drop policy if exists "er_edges_delete_own" on public.er_edges;

create policy "er_edges_select_own"
on public.er_edges
for select
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_edges.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "er_edges_insert_own"
on public.er_edges
for insert
to authenticated
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_edges.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "er_edges_update_own"
on public.er_edges
for update
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_edges.diagram_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_edges.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "er_edges_delete_own"
on public.er_edges
for delete
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = er_edges.diagram_id
      and d.user_id = auth.uid()
  )
);

-- logical_tables
drop policy if exists "logical_tables_select_own" on public.logical_tables;
drop policy if exists "logical_tables_insert_own" on public.logical_tables;
drop policy if exists "logical_tables_update_own" on public.logical_tables;
drop policy if exists "logical_tables_delete_own" on public.logical_tables;

create policy "logical_tables_select_own"
on public.logical_tables
for select
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_tables.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_tables_insert_own"
on public.logical_tables
for insert
to authenticated
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_tables.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_tables_update_own"
on public.logical_tables
for update
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_tables.diagram_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_tables.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_tables_delete_own"
on public.logical_tables
for delete
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_tables.diagram_id
      and d.user_id = auth.uid()
  )
);

-- logical_fields
drop policy if exists "logical_fields_select_own" on public.logical_fields;
drop policy if exists "logical_fields_insert_own" on public.logical_fields;
drop policy if exists "logical_fields_update_own" on public.logical_fields;
drop policy if exists "logical_fields_delete_own" on public.logical_fields;

create policy "logical_fields_select_own"
on public.logical_fields
for select
to authenticated
using (
  exists (
    select 1
    from public.logical_tables t
    join public.diagrams d on d.id = t.diagram_id
    where t.id = logical_fields.table_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_fields_insert_own"
on public.logical_fields
for insert
to authenticated
with check (
  exists (
    select 1
    from public.logical_tables t
    join public.diagrams d on d.id = t.diagram_id
    where t.id = logical_fields.table_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_fields_update_own"
on public.logical_fields
for update
to authenticated
using (
  exists (
    select 1
    from public.logical_tables t
    join public.diagrams d on d.id = t.diagram_id
    where t.id = logical_fields.table_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.logical_tables t
    join public.diagrams d on d.id = t.diagram_id
    where t.id = logical_fields.table_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_fields_delete_own"
on public.logical_fields
for delete
to authenticated
using (
  exists (
    select 1
    from public.logical_tables t
    join public.diagrams d on d.id = t.diagram_id
    where t.id = logical_fields.table_id
      and d.user_id = auth.uid()
  )
);

-- logical_edges
drop policy if exists "logical_edges_select_own" on public.logical_edges;
drop policy if exists "logical_edges_insert_own" on public.logical_edges;
drop policy if exists "logical_edges_update_own" on public.logical_edges;
drop policy if exists "logical_edges_delete_own" on public.logical_edges;

create policy "logical_edges_select_own"
on public.logical_edges
for select
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_edges.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_edges_insert_own"
on public.logical_edges
for insert
to authenticated
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_edges.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_edges_update_own"
on public.logical_edges
for update
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_edges.diagram_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_edges.diagram_id
      and d.user_id = auth.uid()
  )
);

create policy "logical_edges_delete_own"
on public.logical_edges
for delete
to authenticated
using (
  exists (
    select 1
    from public.diagrams d
    where d.id = logical_edges.diagram_id
      and d.user_id = auth.uid()
  )
);
