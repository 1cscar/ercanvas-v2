create or replace function public.share_allows(
  p_diagram_id uuid,
  p_need_editor boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_headers jsonb;
  v_token text;
begin
  v_headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;
  v_token := nullif(v_headers ->> 'x-share-token', '');

  if v_token is null then
    return false;
  end if;

  return exists (
    select 1
    from public.diagram_shares s
    where s.diagram_id = p_diagram_id
      and s.token = v_token
      and s.is_active = true
      and (not p_need_editor or s.permission = 'editor')
  );
end;
$$;

revoke all on function public.share_allows(uuid, boolean) from public;
grant execute on function public.share_allows(uuid, boolean) to anon, authenticated;

-- diagrams

drop policy if exists "diagrams_select_share" on public.diagrams;
create policy "diagrams_select_share"
on public.diagrams
for select
to anon, authenticated
using (public.share_allows(id, false));

drop policy if exists "diagrams_update_share_editor" on public.diagrams;
create policy "diagrams_update_share_editor"
on public.diagrams
for update
to anon, authenticated
using (public.share_allows(id, true))
with check (public.share_allows(id, true));

-- er_nodes

drop policy if exists "er_nodes_select_share" on public.er_nodes;
create policy "er_nodes_select_share"
on public.er_nodes
for select
to anon, authenticated
using (public.share_allows(diagram_id, false));

drop policy if exists "er_nodes_insert_share_editor" on public.er_nodes;
create policy "er_nodes_insert_share_editor"
on public.er_nodes
for insert
to anon, authenticated
with check (public.share_allows(diagram_id, true));

drop policy if exists "er_nodes_update_share_editor" on public.er_nodes;
create policy "er_nodes_update_share_editor"
on public.er_nodes
for update
to anon, authenticated
using (public.share_allows(diagram_id, true))
with check (public.share_allows(diagram_id, true));

drop policy if exists "er_nodes_delete_share_editor" on public.er_nodes;
create policy "er_nodes_delete_share_editor"
on public.er_nodes
for delete
to anon, authenticated
using (public.share_allows(diagram_id, true));

-- er_edges

drop policy if exists "er_edges_select_share" on public.er_edges;
create policy "er_edges_select_share"
on public.er_edges
for select
to anon, authenticated
using (public.share_allows(diagram_id, false));

drop policy if exists "er_edges_insert_share_editor" on public.er_edges;
create policy "er_edges_insert_share_editor"
on public.er_edges
for insert
to anon, authenticated
with check (public.share_allows(diagram_id, true));

drop policy if exists "er_edges_update_share_editor" on public.er_edges;
create policy "er_edges_update_share_editor"
on public.er_edges
for update
to anon, authenticated
using (public.share_allows(diagram_id, true))
with check (public.share_allows(diagram_id, true));

drop policy if exists "er_edges_delete_share_editor" on public.er_edges;
create policy "er_edges_delete_share_editor"
on public.er_edges
for delete
to anon, authenticated
using (public.share_allows(diagram_id, true));

-- logical_tables

drop policy if exists "logical_tables_select_share" on public.logical_tables;
create policy "logical_tables_select_share"
on public.logical_tables
for select
to anon, authenticated
using (public.share_allows(diagram_id, false));

drop policy if exists "logical_tables_insert_share_editor" on public.logical_tables;
create policy "logical_tables_insert_share_editor"
on public.logical_tables
for insert
to anon, authenticated
with check (public.share_allows(diagram_id, true));

drop policy if exists "logical_tables_update_share_editor" on public.logical_tables;
create policy "logical_tables_update_share_editor"
on public.logical_tables
for update
to anon, authenticated
using (public.share_allows(diagram_id, true))
with check (public.share_allows(diagram_id, true));

drop policy if exists "logical_tables_delete_share_editor" on public.logical_tables;
create policy "logical_tables_delete_share_editor"
on public.logical_tables
for delete
to anon, authenticated
using (public.share_allows(diagram_id, true));

-- logical_fields

drop policy if exists "logical_fields_select_share" on public.logical_fields;
create policy "logical_fields_select_share"
on public.logical_fields
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.logical_tables t
    where t.id = logical_fields.table_id
      and public.share_allows(t.diagram_id, false)
  )
);

drop policy if exists "logical_fields_insert_share_editor" on public.logical_fields;
create policy "logical_fields_insert_share_editor"
on public.logical_fields
for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.logical_tables t
    where t.id = logical_fields.table_id
      and public.share_allows(t.diagram_id, true)
  )
);

drop policy if exists "logical_fields_update_share_editor" on public.logical_fields;
create policy "logical_fields_update_share_editor"
on public.logical_fields
for update
to anon, authenticated
using (
  exists (
    select 1
    from public.logical_tables t
    where t.id = logical_fields.table_id
      and public.share_allows(t.diagram_id, true)
  )
)
with check (
  exists (
    select 1
    from public.logical_tables t
    where t.id = logical_fields.table_id
      and public.share_allows(t.diagram_id, true)
  )
);

drop policy if exists "logical_fields_delete_share_editor" on public.logical_fields;
create policy "logical_fields_delete_share_editor"
on public.logical_fields
for delete
to anon, authenticated
using (
  exists (
    select 1
    from public.logical_tables t
    where t.id = logical_fields.table_id
      and public.share_allows(t.diagram_id, true)
  )
);

-- logical_edges

drop policy if exists "logical_edges_select_share" on public.logical_edges;
create policy "logical_edges_select_share"
on public.logical_edges
for select
to anon, authenticated
using (public.share_allows(diagram_id, false));

drop policy if exists "logical_edges_insert_share_editor" on public.logical_edges;
create policy "logical_edges_insert_share_editor"
on public.logical_edges
for insert
to anon, authenticated
with check (public.share_allows(diagram_id, true));

drop policy if exists "logical_edges_update_share_editor" on public.logical_edges;
create policy "logical_edges_update_share_editor"
on public.logical_edges
for update
to anon, authenticated
using (public.share_allows(diagram_id, true))
with check (public.share_allows(diagram_id, true));

drop policy if exists "logical_edges_delete_share_editor" on public.logical_edges;
create policy "logical_edges_delete_share_editor"
on public.logical_edges
for delete
to anon, authenticated
using (public.share_allows(diagram_id, true));
