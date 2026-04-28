alter table public.logical_tables
  add column if not exists name_en text default null;

alter table public.logical_fields
  add column if not exists name_en text default null,
  add column if not exists fk_ref_table_en text default null,
  add column if not exists fk_ref_field_en text default null,
  add column if not exists data_type text default null,
  add column if not exists is_not_null boolean not null default false,
  add column if not exists default_value text default null;
