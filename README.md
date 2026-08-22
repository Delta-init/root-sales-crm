# Root Sales CRM

Control tower for Delta's three sales CRMs. One login for super admins, one-click
SSO into any of the three CRMs, and a consolidated report across all of them.

The three CRMs are **not** modified by this app beyond a single SSO endpoint each.
Their own users keep logging in exactly as before.

| Org        | Currency | Timezone       |
| ---------- | -------- | -------------- |
| Delta      | AED      | `Asia/Dubai`   |
| Draw       | AED      | `Asia/Dubai`   |
| Banglore   | INR      | `Asia/Kolkata` |

Group-report figures are normalised to **AED**, with each org's native currency
shown alongside.

## Layout

    backend/   Express + Mongoose (Bun), API at /api/v1
    web/       Next.js 14 App Router

## Production

    Frontend   root-sales-crm.deltainstitutions.com
    API        root-api-sales-crm.deltainstitutions.com

## SSO (Phase 2)

One login, then one click into any CRM. No password is ever typed twice.

    portal        admin clicks "Open CRM"
      -> POST /api/v1/sso/launch            mints a single-use token (60s TTL)
      -> redirect browser to {crm}/sso?token=...
    CRM /sso page
      -> POST /api/v1/auth/sso-login        forwards the token, never stores it
    CRM backend
      -> GET {portal}/api/auth/verify-sso-token   spends the token, atomically
      -> issues its own normal session

The token is single-use and expires in 60 seconds. It is spent by an atomic
update filtered on `usedAt: null`, so a replay inside the race window fails.
The browser URL is scrubbed with `replaceState` the moment the page reads it,
so it does not survive in history or a Referer header.

### Deploying it

Each CRM needs one environment variable, then a restart:

    ROOT_ERP_API_URL=https://root-api-sales-crm.deltainstitutions.com

Leave it unset and SSO is simply off — the endpoint returns 503 rather than
trusting a token it cannot verify.

Each CRM also needs the portal's service account to already exist in its own
database, with an active status. SSO deliberately will not create it: this
server trusts whatever `ROOT_ERP_API_URL` returns, so auto-creating on demand
would turn a spoofed portal into an instant Super Admin.

| Org      | Service account              |
| -------- | ---------------------------- |
| Delta    | `root@deltainstitutions.com` |
| Banglore | `root@deltainstitutions.com` |
| Draw     | `root@deltainstitutions.com` |

## Running locally

    cd backend && bun install && cp .env.example .env   # fill in .env
    bun run seed                                        # super admin + 3 orgs
    bun run dev

    cd web && bun install && bun run dev
