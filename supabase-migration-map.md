# Supabase migration map

## Live browser sync

The synchronous LocalStorage modules are mirrored through `public.factory_snapshots` as a versioned JSONB state per factory. This is the compatibility path for live multi-device sync; the normalized mappings below are retained for staged migration to per-module tables. Snapshot access is protected by `public.is_factory_member(factory_id)`. The local RBAC UI does not replace server-side role-specific authorization.

## LocalStorage to Supabase mapping

- customers -> public.customers
  - primary key: id
  - factory_id: factory_id
  - relationships: customer_id on quotes/orders/invoices

- products -> public.products
  - primary key: id
  - factory_id: factory_id
  - relationships: product_id on quote_items/order_items/production_items

- quotes -> public.quotes
  - primary key: id
  - factory_id: factory_id
  - relationships: customer_id -> public.customers.id, quote_id -> public.orders.quote_id

- quote_items -> public.quote_items
  - primary key: id
  - factory_id: factory_id
  - relationships: quote_id -> public.quotes.id, product_id -> public.products.id

- orders -> public.orders
  - primary key: id
  - factory_id: factory_id
  - relationships: customer_id -> public.customers.id, quote_id -> public.quotes.id, order_id -> public.order_items, public.invoices, public.production_jobs, public.production_materials_used

- order_items -> public.order_items
  - primary key: id
  - factory_id: factory_id
  - relationships: order_id -> public.orders.id, quote_item_id -> public.quote_items.id, product_id -> public.products.id

- order_status_history -> public.order_status_history
  - primary key: id
  - factory_id: factory_id
  - relationships: order_id -> public.orders.id

- invoices -> public.invoices
  - primary key: id
  - factory_id: factory_id
  - relationships: order_id -> public.orders.id, customer_id -> public.customers.id, invoice_id -> public.invoice_items, public.payments

- invoice_items -> public.invoice_items
  - primary key: id
  - factory_id: factory_id
  - relationships: invoice_id -> public.invoices.id, order_item_id -> public.order_items.id

- payments -> public.payments
  - primary key: id
  - factory_id: factory_id
  - relationships: invoice_id -> public.invoices.id

- production_jobs -> public.production_jobs
  - primary key: id
  - factory_id: factory_id
  - relationships: order_id -> public.orders.id, production_job_id -> public.production_items, public.production_status_history, public.production_qc, public.production_materials_used

- production_items -> public.production_items
  - primary key: id
  - factory_id: factory_id
  - relationships: production_job_id -> public.production_jobs.id, order_item_id -> public.order_items.id

- production_status_history -> public.production_status_history
  - primary key: id
  - factory_id: factory_id
  - relationships: production_job_id -> public.production_jobs.id

- production_qc -> public.production_qc
  - primary key: id
  - factory_id: factory_id
  - relationships: production_job_id -> public.production_jobs.id

- stock_items -> public.stock_items
  - primary key: id
  - factory_id: factory_id
  - relationships: stock_item_id -> public.stock_movements, public.production_materials_used

- stock_movements -> public.stock_movements
  - primary key: id
  - factory_id: factory_id
  - relationships: stock_item_id -> public.stock_items.id, production_job_id -> public.production_jobs.id, order_id -> public.orders.id

- production_materials_used -> public.production_materials_used
  - primary key: id
  - factory_id: factory_id
  - relationships: production_job_id -> public.production_jobs.id, stock_item_id -> public.stock_items.id, order_id -> public.orders.id

- suppliers -> public.suppliers
  - primary key: id
  - factory_id: factory_id
- purchaseOrders -> public.purchase_orders
  - primary key: id
  - factory_id: factory_id
  - relationships: supplier_id -> public.suppliers.id
- goodsReceipts -> public.goods_receipts
  - primary key: id
  - factory_id: factory_id
  - relationships: purchase_order_id -> public.purchase_orders.id
- workCentres -> public.work_centres
  - primary key: id
  - factory_id: factory_id
- productionSchedules -> public.production_schedules
  - primary key: id
  - factory_id: factory_id
  - relationships: production_job_id -> public.production_jobs.id, work_centre_id -> public.work_centres.id
- qcInspections -> public.qc_inspections
  - primary key: id
  - factory_id: factory_id
  - relationships: production_job_id -> public.production_jobs.id
- users / activeUserId -> Supabase Auth + public.memberships
  - Local user profiles are not a substitute for Auth identities.

- complete `frameflow` state -> public.factory_snapshots
  - primary key: factory_id
  - state: versioned JSONB snapshot of all LocalStorage module collections
  - RLS: `public.is_factory_member(factory_id)` for all access

- settings/company profile -> public.factories + public.quote_pricing (if needed)
  - settings.companyName -> public.factories.name
  - settings.address -> public.factories.address
  - settings.phone -> public.factories.phone
  - settings.email -> public.factories.email
  - settings.vatNumber -> public.factories.vat_number
  - settings.companyRegistration -> public.factories.registration_details
  - settings.website -> public.factories.website (not yet present in the SQL schema; add if required)
  - settings.quotationFooter / settings.invoiceFooter -> quoted/invoice footer fields on the application layer or a dedicated settings table if added later

## Required configuration to enable Supabase

- `SUPABASE_URL`: the real project URL, for example `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY`: the public anonymous/publishable key
- `FACTORY_ID`: optional valid UUID; otherwise discovered from the signed-in user's memberships
- Auth: Supabase Auth configured for email/password or a supported provider
- RLS: enabled on all tenant tables

## Current status

- A project URL and public browser key are configured, but no fixed factory UUID is set.
- Authentication and factory membership must be provisioned in Supabase before cloud sync can start.
- LocalStorage remains authoritative until a signed-in user explicitly pulls or initializes a factory snapshot from the Security page.
