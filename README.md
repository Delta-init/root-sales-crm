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

## Running locally

    cd backend && bun install && cp .env.example .env   # fill in .env
    bun run seed                                        # super admin + 3 orgs
    bun run dev

    cd web && bun install && bun run dev
