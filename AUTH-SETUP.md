# Auth & privacy setup — login gate + RLS lockdown

The dashboard is gated behind Supabase Auth. The front-end login gate already
lives in `index.html`; the database lockdown is a separate, manual cutover (it
touches the live database, so it can't safely be auto-applied).

> ⚠️ Until the RLS step is done, every row is still readable/writable with the
> public publishable key. The login gate alone only hides the UI — finish the
> cutover below to make the data actually private.

## Status

- [x] Front-end email/password login gate (`index.html`)
- [x] RLS policies rewritten to `authenticated`-only (`supabase-schema.sql`)
- [x] Monthly Action switched to the service-role key (`scripts/queue-verifications.mjs`, workflow)
- [ ] Login account created in Supabase
- [ ] Public sign-ups disabled
- [ ] `SUPABASE_SERVICE_ROLE_KEY` added as a GitHub Actions secret
- [ ] Gate deployed to production (merge to `main`)
- [ ] **RLS lockdown applied to the live database — do this LAST**

## Enabling the Supabase MCP in Claude Code on the web

The Supabase MCP (`.mcp.json` → `https://mcp.supabase.com`) connects directly
from the sandbox, so its host must be in the environment's **network allowlist**.
The default level ("Trusted") doesn't include it, which produces
`403 — Host not in allowlist` when starting the OAuth flow.

Fix — edit the environment → **Network access** → **Custom** (leave *"Also
include default list of common package managers"* checked) → add, one per line:

```
*.supabase.com
*.supabase.co
```

(Or choose **Full** for any-domain access.) Network changes apply to **new
sessions**, so start a fresh web session on this branch afterward, then ask
Claude to authenticate the Supabase MCP. Claude will hand you an authorization
URL; after you approve it, copy the `http://localhost:.../callback?...` URL from
the browser address bar back into the chat to complete the flow.

## Cutover runbook (order matters)

Flipping RLS before the gate is live **and** an account exists will break the
live site (logged-out requests, which is all of production until then, lose
access). Do these in order:

1. **Deploy the gate to production** — merge this branch into `main` (Vercel
   serves `main`). Preview-test on the branch's Vercel preview URL first.
2. **Create your account** — Supabase → Authentication → Users → *Add user*:
   email + a strong password, with **Auto Confirm User** enabled.
3. **Disable public sign-ups** — Authentication → Providers → Email → turn off
   *"Allow new users to sign up"* (so only your account can ever exist).
4. **Add the GitHub secret** — repo → Settings → Secrets and variables →
   Actions → `SUPABASE_SERVICE_ROLE_KEY` = Supabase → Project Settings → API →
   `service_role` key. Delete the now-unused `SUPABASE_PUBLISHABLE_KEY` secret.
5. **Apply the RLS lockdown** — run the policy block from `supabase-schema.sql`
   (via the Supabase MCP or the SQL editor). **This is when access locks down.**
6. **Verify** — a logged-out / incognito REST call returns nothing; the
   logged-in dashboard loads normally; a manual "Run workflow" on the Action
   succeeds with the service-role key.

The publishable key staying public in `/api/config` is fine — it's designed to
be public and grants nothing once RLS is locked. The **service-role key must
never** be committed or shipped to the browser; it belongs only in the GitHub
Actions secret.

## RLS policy block (kept in sync with `supabase-schema.sql`)

```sql
alter table deals                  enable row level security;
alter table settings               enable row level security;
alter table pending_verifications  enable row level security;
alter table verification_log       enable row level security;

drop policy if exists "deals all anon"                  on deals;
drop policy if exists "settings all anon"               on settings;
drop policy if exists "pending_verifications all anon"  on pending_verifications;
drop policy if exists "verification_log all anon"       on verification_log;

drop policy if exists "deals authenticated"                  on deals;
drop policy if exists "settings authenticated"               on settings;
drop policy if exists "pending_verifications authenticated"  on pending_verifications;
drop policy if exists "verification_log authenticated"       on verification_log;

create policy "deals authenticated"                  on deals                  for all to authenticated using (true) with check (true);
create policy "settings authenticated"               on settings               for all to authenticated using (true) with check (true);
create policy "pending_verifications authenticated"  on pending_verifications  for all to authenticated using (true) with check (true);
create policy "verification_log authenticated"       on verification_log       for all to authenticated using (true) with check (true);
```
