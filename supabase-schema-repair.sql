-- Safe repair for a partially initialized database.
-- This file changes enum metadata only. It does not drop data, tables, schemas, or policies.
-- Run this only if the original schema stopped at an existing enum error.

select
  n.nspname as schema_name,
  t.typname as type_name,
  array_agg(e.enumlabel order by e.enumsortorder) as existing_values
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
  and t.typname in ('user_role', 'quote_status', 'order_status')
group by n.nspname, t.typname
order by t.typname;

do $$
declare
  enum_name text;
  required_value text;
  required_values text[];
begin
  foreach enum_name in array array['user_role', 'quote_status', 'order_status'] loop
    if not exists (
      select 1 from pg_type
      where typnamespace = 'public'::regnamespace
        and typname = enum_name
        and typtype = 'e'
    ) then
      raise exception 'Expected existing public.% enum was not found; do not guess its definition.', enum_name;
    end if;
  end loop;

  required_values := array['owner', 'admin', 'sales', 'production', 'worker', 'procurement', 'installer'];
  foreach required_value in array required_values loop
    execute format('alter type public.user_role add value if not exists %L', required_value);
  end loop;

  required_values := array['draft', 'sent', 'accepted', 'rejected'];
  foreach required_value in array required_values loop
    execute format('alter type public.quote_status add value if not exists %L', required_value);
  end loop;

  required_values := array['new', 'confirmed', 'in_production', 'ready', 'delivered', 'installed', 'completed', 'cancelled'];
  foreach required_value in array required_values loop
    execute format('alter type public.order_status add value if not exists %L', required_value);
  end loop;
end $$;

select
  n.nspname as schema_name,
  t.typname as type_name,
  array_agg(e.enumlabel order by e.enumsortorder) as verified_values
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
  and t.typname in ('user_role', 'quote_status', 'order_status')
group by n.nspname, t.typname
order by t.typname;
