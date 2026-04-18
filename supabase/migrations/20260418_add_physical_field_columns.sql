alter table public.logical_fields
  add column if not exists data_type text default null,
  add column if not exists is_not_null boolean default false,
  add column if not exists default_value text default null;
