# Supabase activation guide

This guide activates Supabase only after a real project exists. The current browser application remains LocalStorage-backed until connection testing succeeds. Do not delete or clear the `frameflow` LocalStorage key.

The browser connector requires a real Supabase project, public Publishable/anon key, Auth user, factory, and membership. A fixed `FACTORY_ID` is optional because the Security page discovers factories from the signed-in user's memberships. No sync starts until a user explicitly pulls or initializes a factory snapshot.

## 1. Create a Supabase project

1. Open the Supabase dashboard and create a new project.
2. Choose the organisation, project name, region, and a strong database password.
3. Wait for the project to finish provisioning.

## 2. Find the Project URL

Open **Project Settings > API** and copy **Project URL**. It has the form `https://<project-ref>.supabase.co`.

## 3. Find the public key

In **Project Settings > API**, copy the public **Publishable key** (or the legacy public `anon` key if that is what the project exposes). This key is allowed in browser code. Never put the `service_role` secret in this application.

## 4. Create the first factory (after running the schema in step 7)

After the schema has been run, create a row in `public.factories` using the Table Editor or SQL Editor. Copy its generated UUID. The Security page can discover it through Auth membership; optionally set it as `FACTORY_ID` for a fixed-factory deployment.

## 5. Create the first owner/admin user

In **Authentication > Users**, select **Add user** and create the first real user. Use email confirmation settings appropriate for the project. Do not create a fake authentication implementation in the application.

## 6. Add factory membership (after running the schema in step 7)

After copying the user's Auth UUID and factory UUID, insert a membership in the SQL Editor:

```sql
insert into public.memberships (factory_id, user_id, role)
values ('YOUR_FACTORY_UUID', 'YOUR_AUTH_USER_UUID', 'owner');
```

The allowed roles are `owner`, `admin`, `sales`, `production`, `worker`, `procurement`, and `installer`.

## 7. Run the schema

If an earlier run stopped with `type "user_role" already exists`, first open [supabase-schema-repair.sql](supabase-schema-repair.sql). Otherwise open [supabase-schema.sql](supabase-schema.sql). Both scripts are non-destructive and safe to rerun; the repair script only verifies and completes enum values. Open **SQL Editor > New query**, paste the selected file, review it, and click **Run**. Run the full schema against the project before entering business data. Keep a backup of any existing project before applying later migrations.

The full schema creates missing enum types conditionally, preserves existing compatible enum types, creates missing tables conditionally, replaces only its own named RLS policies, and uses `if not exists` for indexes, columns, and the stock constraint replacement. It does not drop tables, schemas, or data. If the repair query reports an unexpected enum definition or missing enum, stop and inspect that database rather than guessing.

In the SQL Editor, success means the query completes without a red error banner. The repair file also returns a first and final result set showing the enum values. For the full schema, verify the result by opening **Table Editor** and confirming the expected tables, then run the verification queries below.

## 8. Verify tables

In **Table Editor**, confirm the expected tables exist, including `factories`, `memberships`, `factory_snapshots`, `customers`, `products`, `quotes`, `quote_items`, `orders`, `order_items`, `invoices`, `invoice_items`, `payments`, `production_jobs`, `production_items`, `production_status_history`, `production_qc`, `stock_items`, `stock_movements`, `production_materials_used`, `suppliers`, `purchase_orders`, `goods_receipts`, `work_centres`, `production_schedules`, and `qc_inspections`.

## 9. Verify RLS

In **Authentication > Users**, sign in as a user belonging to Factory A and verify that queries scoped to Factory A work. Create a second factory and membership, then verify the first user cannot select, insert, update, or delete rows whose `factory_id` is Factory B. Repeat this with a user who has no membership and expect denial.

RLS uses `public.is_factory_member(factory_id)`, which checks `auth.uid()` against `public.memberships`. Every tenant table carries `factory_id`, and policies use both `using` and `with check`. Keep service-role operations server-side because service-role clients bypass RLS.

## 10. Connect this application

Copy [supabase-config-template.js](supabase-config-template.js) to a local configuration file that is loaded before [factory-core.js](factory-core.js), or inject `window.FRAMEFLOW_SUPABASE_CONFIG` through a deployment environment. Populate only these values:

```text
SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
FACTORY_ID=OPTIONAL_WHEN_USING_AUTH_MEMBERSHIP_DISCOVERY
```

Then set `enabled: true`. Do not commit the populated file. Do not add a service-role key to frontend configuration.

The module pages load `supabase-adapter.js` after `factory-core.js`; the connector can initialize from URL/public key without a fixed factory ID. Until an Auth user signs in, selects a factory membership, and explicitly pulls or initializes its snapshot from the Security page, every module continues reading and writing LocalStorage. The sync layer stores the complete state in a versioned row in `public.factory_snapshots`, preserving synchronous module APIs. It retains an on-device backup before pulls/replacements, queues saves offline, and pauses on version conflicts instead of silently overwriting remote data.

Snapshot RLS isolates complete factory states by membership. Existing normalized tenant tables retain their own tenant RLS policies. The legacy UI role switcher remains client-side, not server authorization; it does not prevent a member from modifying data within their own factory. Production-grade role-specific writes require normalized table access and role-specific RLS policies.

## 11. Sign in and start snapshot sync

1. Open **Security** and sign in with the real Supabase Auth user. The app never stores the password.
2. Refresh memberships and select a factory the signed-in user belongs to.
3. If a snapshot exists, choose **Pull cloud snapshot**. The current browser value is backed up before it is replaced.
4. If no snapshot exists, an `owner` or `admin` membership can choose **Initialize cloud from local**. This creates the first `factory_snapshots` row.
5. For an intentional local-to-cloud replacement, use **Replace cloud with local** only after reviewing the local data. It keeps a local backup and uses a version check.

After pull/initialization, changes to the `frameflow` LocalStorage key are queued and synchronized. Offline changes stay local and are retried when connectivity returns. If another browser has advanced the snapshot, sync pauses and preserves local changes; pull the remote version or have an owner/admin resolve the conflict. The snapshot row is the live compatibility store for all existing synchronous modules; normalized tables are tenant-isolated and available for later staged per-module migration.

Test with two factories and two Auth users: verify each membership can select only its factory, confirm snapshot reads/writes for that factory succeed, and confirm another factory's snapshot cannot be selected, read, or modified. Test offline edits, reconnect, and a simultaneous version conflict before entering live data.

## 12. Migrate LocalStorage safely

The Security page's snapshot pull/initialize workflow is the compatibility migration for the current app. The separate `frameflowMigration` utility targets normalized tables and is not the live browser sync path:

1. Export or back up the browser's `frameflow` value.
2. Run `frameflowMigration.buildPlan(frameflow.readDb(), FACTORY_ID)` as a dry run.
3. Review validation errors, row counts, generated ID mappings, and relationship mappings.
4. Use `frameflowMigration.migrate({ state, factoryId, dryRun: false, client })` only from a trusted server-side migration runner with a configured Supabase client.
5. Verify inserted counts and relationships in Supabase.
6. Keep the original LocalStorage data until the migration and application acceptance tests pass.

The migration utility never deletes LocalStorage records. A failed row is reported with its table and source ID. The service-role secret, if needed for a trusted migration runner, must be supplied through that runner's server-only environment and must never be requested by or embedded in browser code.

## Schema verification queries

Run these in a separate SQL Editor query after the schema finishes:

```sql
select typname, array_agg(enumlabel order by enumsortorder) as values
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typnamespace = 'public'::regnamespace
	and t.typname in ('user_role', 'quote_status', 'order_status')
group by typname
order by typname;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

The first query must show the required enum values, including `worker` and `procurement`. The second must show `rowsecurity = true` for every tenant table, including `factory_snapshots`. The third must show the tenant policies, including `members can access factory`, `members can access memberships`, `members can access factory snapshot`, and the table-specific isolation policies.

## Required values before activation

- Supabase Project URL
- public Publishable/anon key
- Factory UUID (selected from the signed-in user's memberships; fixed `FACTORY_ID` is optional)
- Auth user and membership setup
- A decision on the server-side migration runner and its secret storage
