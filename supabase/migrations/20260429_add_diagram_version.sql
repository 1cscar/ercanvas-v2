-- Add optimistic-locking version column to diagrams table.
-- The version increments on every save via a trigger, allowing the frontend
-- to detect conflicting writes from other tabs or devices.

alter table public.diagrams
  add column if not exists version integer not null default 1;

-- Trigger: auto-increment version on every UPDATE to diagrams.
create or replace function public.increment_diagram_version()
returns trigger
language plpgsql
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists trg_increment_diagram_version on public.diagrams;

create trigger trg_increment_diagram_version
  before update on public.diagrams
  for each row
  execute function public.increment_diagram_version();
