create extension if not exists "pgcrypto";
do $$ begin
	if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'user_role') then
		create type public.user_role as enum ('owner','admin','sales','production','worker','procurement','installer');
	end if;
	if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'quote_status') then
		create type public.quote_status as enum ('draft','sent','accepted','rejected');
	end if;
	if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'order_status') then
		create type public.order_status as enum ('new','confirmed','in_production','ready','delivered','installed','completed','cancelled');
	end if;
end $$;

do $$
declare required_value text; enum_name text; enum_values text[];
begin
	foreach enum_name in array array['user_role','quote_status','order_status'] loop
		if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = enum_name and typtype = 'e') then
			raise exception 'public.% must be an enum type', enum_name;
		end if;
	end loop;
	enum_values := array['owner','admin','sales','production','worker','procurement','installer'];
	foreach required_value in array enum_values loop execute format('alter type public.user_role add value if not exists %L', required_value); end loop;
	enum_values := array['draft','sent','accepted','rejected'];
	foreach required_value in array enum_values loop execute format('alter type public.quote_status add value if not exists %L', required_value); end loop;
	enum_values := array['new','confirmed','in_production','ready','delivered','installed','completed','cancelled'];
	foreach required_value in array enum_values loop execute format('alter type public.order_status add value if not exists %L', required_value); end loop;
end $$;

create table if not exists public.factories (id uuid primary key default gen_random_uuid(), name text not null, logo_url text, address text, phone text, email text, vat_number text, registration_details text, created_at timestamptz not null default now());
create table if not exists public.memberships (factory_id uuid references public.factories(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, role public.user_role not null default 'sales', primary key(factory_id,user_id));
create table if not exists public.customers (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, name text not null, company text, phone text, email text, address text, postcode text, notes text, created_at timestamptz not null default now());
create table if not exists public.products (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, product_type text not null, width_mm integer not null check(width_mm>0), height_mm integer not null check(height_mm>0), quantity integer not null check(quantity>0), colour text, glass_type text, opening_type text, frame_profile text, hardware text, notes text);
create table if not exists public.quotes (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, customer_id uuid not null references public.customers(id), quote_number text not null, status public.quote_status not null default 'draft', subtotal numeric(12,2) not null default 0, discount numeric(12,2) not null default 0, vat_rate numeric(5,4) not null default .2, total numeric(12,2) not null default 0, quote_date date not null default current_date, unique(factory_id,quote_number));
create table if not exists public.quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id) on delete cascade, product_id uuid references public.products(id), description text not null, quantity integer not null check(quantity>0), unit_price numeric(12,2) not null check(unit_price>=0));
alter table public.quote_items add column if not exists factory_id uuid references public.factories(id) on delete cascade;
create table if not exists public.orders (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, customer_id uuid not null references public.customers(id), quote_id uuid references public.quotes(id), order_number text not null, status public.order_status not null default 'new', total numeric(12,2) not null default 0, unique(factory_id,order_number));
create table if not exists public.invoices (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, order_id uuid not null references public.orders(id), invoice_number text not null, subtotal numeric(12,2) not null, vat numeric(12,2) not null, total numeric(12,2) not null, deposit numeric(12,2) not null default 0, unique(factory_id,invoice_number));
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, invoice_id uuid not null references public.invoices(id) on delete cascade, amount numeric(12,2) not null check(amount>0), paid_at timestamptz not null default now(), method text not null);
create table if not exists public.production_jobs (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, order_id uuid not null references public.orders(id) on delete cascade, product_id uuid references public.products(id), status text not null default 'queued');
create table if not exists public.stock_items (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, category text not null, name text not null, sku text, quantity numeric(12,2) not null default 0, reorder_point numeric(12,2) not null default 0);

alter table public.factories enable row level security;
alter table public.memberships enable row level security;
create or replace function public.is_factory_member(target_factory uuid) returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from memberships where factory_id=target_factory and user_id=auth.uid()) $$;
drop policy if exists "members can access factory" on public.factories;
create policy "members can access factory" on public.factories for select using (public.is_factory_member(id));
drop policy if exists "members can access memberships" on public.memberships;
create policy "members can access memberships" on public.memberships for select using (user_id=auth.uid() or public.is_factory_member(factory_id));
drop policy if exists "tenant isolation" on public.customers;
drop policy if exists "tenant isolation" on public.products;
drop policy if exists "tenant isolation" on public.quotes;
drop policy if exists "tenant isolation" on public.quote_items;
drop policy if exists "tenant isolation" on public.orders;
drop policy if exists "tenant isolation" on public.invoices;
drop policy if exists "tenant isolation" on public.payments;
drop policy if exists "tenant isolation" on public.production_jobs;
drop policy if exists "tenant isolation" on public.stock_items;
do $$ declare table_name text; begin for table_name in select unnest(array['customers','products','quotes','quote_items','orders','invoices','payments','production_jobs','stock_items']) loop execute format('alter table public.%I enable row level security',table_name); execute format('create policy "tenant isolation" on public.%I for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id))',table_name); end loop; end $$;

alter table public.quotes add column if not exists valid_until date;
alter table public.quotes add column if not exists terms text;
create table if not exists public.quote_pricing (factory_id uuid primary key references public.factories(id) on delete cascade, window_profile numeric(12,2) not null default 180, door_profile numeric(12,2) not null default 260, glass numeric(12,2) not null default 55, colour numeric(12,2) not null default 35, hardware numeric(12,2) not null default 85, opening numeric(12,2) not null default 25, options numeric(12,2) not null default 40, labour numeric(12,2) not null default 95, delivery numeric(12,2) not null default 120, installation numeric(12,2) not null default 180, updated_at timestamptz not null default now());
alter table public.quote_pricing enable row level security;
drop policy if exists "tenant pricing isolation" on public.quote_pricing;
create policy "tenant pricing isolation" on public.quote_pricing for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));

alter table public.orders add column if not exists order_date date not null default current_date;
alter table public.orders add column if not exists required_delivery_date date;
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists delivery_notes text;
alter table public.orders add column if not exists delivery_status text not null default 'Pending';
alter table public.orders add column if not exists installation_required boolean not null default true;
alter table public.orders add column if not exists installation_date date;
alter table public.orders add column if not exists installer text;
alter table public.orders add column if not exists installation_notes text;
alter table public.orders add column if not exists installation_status text not null default 'Not Scheduled';
alter table public.orders add column if not exists notes text;
create table if not exists public.order_items (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, order_id uuid not null references public.orders(id) on delete cascade, quote_item_id uuid references public.quote_items(id), product_id uuid references public.products(id), product_type text not null, width_mm integer not null check(width_mm>0), height_mm integer not null check(height_mm>0), quantity integer not null check(quantity>0), colour text, glass_type text, opening_type text, frame_profile text, hardware text, notes text, unit_price numeric(12,2) not null default 0, line_total numeric(12,2) not null default 0);
create table if not exists public.order_status_history (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, order_id uuid not null references public.orders(id) on delete cascade, previous_status public.order_status, new_status public.order_status not null, changed_at timestamptz not null default now(), changed_by uuid references auth.users(id));
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
drop policy if exists "tenant order items isolation" on public.order_items;
create policy "tenant order items isolation" on public.order_items for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));
drop policy if exists "tenant order history isolation" on public.order_status_history;
create policy "tenant order history isolation" on public.order_status_history for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));

alter table public.invoices add column if not exists customer_id uuid references public.customers(id);
alter table public.invoices add column if not exists invoice_date date not null default current_date;
alter table public.invoices add column if not exists due_date date not null default current_date;
alter table public.invoices add column if not exists discount numeric(12,2) not null default 0;
alter table public.invoices add column if not exists vat_rate numeric(5,4) not null default .2;
alter table public.invoices add column if not exists vat_amount numeric(12,2) not null default 0;
alter table public.invoices add column if not exists amount_paid numeric(12,2) not null default 0;
alter table public.invoices add column if not exists balance_due numeric(12,2) not null default 0;
alter table public.invoices add column if not exists status text not null default 'Unpaid';
alter table public.invoices add column if not exists notes text;
alter table public.invoices add column if not exists terms text;
alter table public.invoices add column if not exists updated_at timestamptz not null default now();
create table if not exists public.invoice_items (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, invoice_id uuid not null references public.invoices(id) on delete cascade, order_item_id uuid references public.order_items(id), product_type text not null, description text, width_mm integer, height_mm integer, quantity integer not null check(quantity>0), unit_price numeric(12,2) not null default 0, line_total numeric(12,2) not null default 0);
alter table public.payments add column if not exists payment_date date not null default current_date;
alter table public.payments add column if not exists payment_method text;
alter table public.payments add column if not exists reference text;
alter table public.payments add column if not exists notes text;
alter table public.payments add column if not exists created_by uuid references auth.users(id);
alter table public.payments add column if not exists created_at timestamptz not null default now();
alter table public.invoice_items enable row level security;
drop policy if exists "tenant invoice items isolation" on public.invoice_items;
create policy "tenant invoice items isolation" on public.invoice_items for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));

create table if not exists public.production_jobs (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, order_id uuid not null references public.orders(id) on delete cascade, job_number text not null, status text not null default 'Pending', priority text not null default 'Normal', assigned_to uuid references auth.users(id), scheduled_date date, started_at timestamptz, completed_at timestamptz, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(factory_id,job_number));
create table if not exists public.production_items (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, production_job_id uuid not null references public.production_jobs(id) on delete cascade, order_item_id uuid references public.order_items(id), product_type text not null, width integer not null, height integer not null, quantity integer not null, colour text, glass_type text, opening_type text, profile text, hardware text, notes text);
create table if not exists public.production_status_history (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, production_job_id uuid not null references public.production_jobs(id) on delete cascade, previous_status text, new_status text not null, changed_by uuid references auth.users(id), changed_at timestamptz not null default now());
create table if not exists public.production_qc (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, production_job_id uuid not null references public.production_jobs(id) on delete cascade, frame_dimensions_checked boolean not null default false, glass_checked boolean not null default false, colour_checked boolean not null default false, hardware_checked boolean not null default false, opening_checked boolean not null default false, visual_inspection_passed boolean not null default false, qc_status text not null default 'Pending', qc_notes text, checked_by uuid references auth.users(id), checked_at timestamptz);
alter table public.production_jobs enable row level security;
alter table public.production_items enable row level security;
alter table public.production_status_history enable row level security;
alter table public.production_qc enable row level security;
drop policy if exists "tenant production jobs isolation" on public.production_jobs;
create policy "tenant production jobs isolation" on public.production_jobs for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));
drop policy if exists "tenant production items isolation" on public.production_items;
create policy "tenant production items isolation" on public.production_items for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));
drop policy if exists "tenant production history isolation" on public.production_status_history;
create policy "tenant production history isolation" on public.production_status_history for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));
drop policy if exists "tenant production qc isolation" on public.production_qc;
create policy "tenant production qc isolation" on public.production_qc for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));

alter table public.production_jobs add column if not exists job_number text;
alter table public.production_jobs add column if not exists priority text not null default 'Normal';
alter table public.production_jobs add column if not exists assigned_to uuid references auth.users(id);
alter table public.production_jobs add column if not exists scheduled_date date;
alter table public.production_jobs add column if not exists started_at timestamptz;
alter table public.production_jobs add column if not exists completed_at timestamptz;
alter table public.production_jobs add column if not exists notes text;
alter table public.production_jobs add column if not exists created_at timestamptz not null default now();
alter table public.production_jobs add column if not exists updated_at timestamptz not null default now();

alter table public.stock_items add column if not exists stock_code text;
alter table public.stock_items add column if not exists description text;
alter table public.stock_items add column if not exists unit text not null default 'Units';
alter table public.stock_items add column if not exists minimum_stock_level numeric(12,2) not null default 0;
alter table public.stock_items add column if not exists maximum_stock_level numeric(12,2) not null default 0;
alter table public.stock_items add column if not exists unit_cost numeric(12,2) not null default 0;
alter table public.stock_items add column if not exists supplier_name text;
alter table public.stock_items add column if not exists supplier_reference text;
alter table public.stock_items add column if not exists supplier_contact text;
alter table public.stock_items add column if not exists location text;
alter table public.stock_items add column if not exists updated_at timestamptz not null default now();
create table if not exists public.stock_movements (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, stock_item_id uuid not null references public.stock_items(id) on delete restrict, movement_type text not null check(movement_type in ('Stock In','Stock Out','Adjustment')), quantity numeric(12,2) not null check(quantity>=0), previous_quantity numeric(12,2) not null, new_quantity numeric(12,2) not null check(new_quantity>=0), reference text, reason text, supplier text, production_job_id uuid references public.production_jobs(id), order_id uuid references public.orders(id), notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now());
alter table public.stock_movements enable row level security;
drop policy if exists "tenant stock movements isolation" on public.stock_movements;
create policy "tenant stock movements isolation" on public.stock_movements for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));

alter table public.stock_items add column if not exists is_active boolean not null default true;
create table if not exists public.production_materials_used (id uuid primary key default gen_random_uuid(), factory_id uuid not null references public.factories(id) on delete cascade, production_job_id uuid not null references public.production_jobs(id) on delete cascade, stock_item_id uuid not null references public.stock_items(id), quantity numeric(12,2) not null check(quantity>0), unit_cost numeric(12,2) not null default 0, notes text, used_at timestamptz not null default now(), used_by uuid references auth.users(id), unique(production_job_id,stock_item_id,used_at));
alter table public.production_materials_used enable row level security;
drop policy if exists "tenant production materials isolation" on public.production_materials_used;
create policy "tenant production materials isolation" on public.production_materials_used for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id));

alter table public.production_materials_used add column if not exists order_id uuid references public.orders(id);
alter table public.production_materials_used add column if not exists unit text;
alter table public.production_materials_used add column if not exists line_cost numeric(12,2) not null default 0;
alter table public.production_materials_used add column if not exists reference text;
alter table public.production_materials_used add column if not exists transaction_id text;
create unique index if not exists production_materials_used_transaction_item_unique on public.production_materials_used(factory_id, transaction_id, stock_item_id) where transaction_id is not null;
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (movement_type in ('Stock In','Stock Out','Adjustment','Adjustment Increase','Adjustment Decrease','Production Usage'));

alter table public.factories add column if not exists website text;
create index if not exists memberships_user_factory_idx on public.memberships(user_id, factory_id);
create index if not exists customers_factory_created_idx on public.customers(factory_id, created_at);
create index if not exists products_factory_active_idx on public.products(factory_id);
create index if not exists quotes_factory_status_idx on public.quotes(factory_id, status);
create index if not exists quote_items_factory_quote_idx on public.quote_items(factory_id, quote_id);
create index if not exists orders_factory_status_idx on public.orders(factory_id, status);
create index if not exists order_items_factory_order_idx on public.order_items(factory_id, order_id);
create index if not exists invoices_factory_status_idx on public.invoices(factory_id, status);
create index if not exists invoice_items_factory_invoice_idx on public.invoice_items(factory_id, invoice_id);
create index if not exists payments_factory_invoice_idx on public.payments(factory_id, invoice_id);
create index if not exists production_jobs_factory_status_idx on public.production_jobs(factory_id, status);
create index if not exists production_items_factory_job_idx on public.production_items(factory_id, production_job_id);
create index if not exists production_history_factory_job_idx on public.production_status_history(factory_id, production_job_id);
create index if not exists production_qc_factory_job_idx on public.production_qc(factory_id, production_job_id);
create index if not exists stock_items_factory_active_idx on public.stock_items(factory_id, is_active);
create index if not exists stock_movements_factory_item_idx on public.stock_movements(factory_id, stock_item_id, created_at);
create index if not exists materials_used_factory_job_idx on public.production_materials_used(factory_id, production_job_id);

-- Local-first application synchronization. The payload contains the complete
-- normalized FrameFlow state so older synchronous page runtimes can sync
-- without changing their local CRUD API. Normalized tenant tables above remain
-- available for staged per-module migration.
create table if not exists public.factory_snapshots (
	factory_id uuid primary key references public.factories(id) on delete cascade,
	state jsonb not null default '{}'::jsonb,
	version bigint not null default 1 check (version > 0),
	updated_at timestamptz not null default now(),
	updated_by uuid references auth.users(id)
);

alter table public.factory_snapshots enable row level security;
drop policy if exists "members can access factory snapshot" on public.factory_snapshots;
create policy "members can access factory snapshot" on public.factory_snapshots
	for all using (public.is_factory_member(factory_id))
	with check (public.is_factory_member(factory_id));
grant select, insert, update on public.factory_snapshots to authenticated;

create table if not exists public.suppliers (
	id uuid primary key default gen_random_uuid(),
	factory_id uuid not null references public.factories(id) on delete cascade,
	name text not null,
	data jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	unique(factory_id, name)
);
create table if not exists public.purchase_orders (
	id uuid primary key default gen_random_uuid(),
	factory_id uuid not null references public.factories(id) on delete cascade,
	po_number text not null,
	supplier_id uuid references public.suppliers(id),
	status text not null default 'Draft',
	data jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	unique(factory_id, po_number)
);
create table if not exists public.goods_receipts (
	id uuid primary key default gen_random_uuid(),
	factory_id uuid not null references public.factories(id) on delete cascade,
	receipt_number text not null,
	purchase_order_id uuid references public.purchase_orders(id),
	data jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	unique(factory_id, receipt_number)
);
create table if not exists public.work_centres (
	id uuid primary key default gen_random_uuid(),
	factory_id uuid not null references public.factories(id) on delete cascade,
	name text not null,
	data jsonb not null default '{}'::jsonb,
	unique(factory_id, name)
);
create table if not exists public.production_schedules (
	id uuid primary key default gen_random_uuid(),
	factory_id uuid not null references public.factories(id) on delete cascade,
	production_job_id uuid references public.production_jobs(id) on delete set null,
	work_centre_id uuid references public.work_centres(id) on delete set null,
	scheduled_date date not null,
	data jsonb not null default '{}'::jsonb
);
create table if not exists public.qc_inspections (
	id uuid primary key default gen_random_uuid(),
	factory_id uuid not null references public.factories(id) on delete cascade,
	production_job_id uuid references public.production_jobs(id) on delete cascade,
	checkpoint text not null,
	result text not null check (result in ('Pass', 'Fail')),
	data jsonb not null default '{}'::jsonb,
	inspected_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
	foreach table_name in array array['suppliers','purchase_orders','goods_receipts','work_centres','production_schedules','qc_inspections'] loop
		execute format('alter table public.%I enable row level security', table_name);
		execute format('drop policy if exists %I on public.%I', 'tenant isolation', table_name);
		execute format('create policy %I on public.%I for all using (public.is_factory_member(factory_id)) with check (public.is_factory_member(factory_id))', 'tenant isolation', table_name);
	end loop;
end $$;

grant select, insert, update, delete on public.suppliers, public.purchase_orders, public.goods_receipts, public.work_centres, public.production_schedules, public.qc_inspections to authenticated;
create index if not exists factory_snapshots_updated_idx on public.factory_snapshots(factory_id, updated_at);
create index if not exists purchase_orders_factory_status_idx on public.purchase_orders(factory_id, status);
create index if not exists production_schedules_factory_date_idx on public.production_schedules(factory_id, scheduled_date);
create index if not exists qc_inspections_factory_job_idx on public.qc_inspections(factory_id, production_job_id, inspected_at);
