# Customers (HO portal)

**Base URL:** `{API_BASE}/api/v2` · `Authorization: Bearer <SSO access token>` ·
capability `leads.read` (heads).

Every partner's customers — farmers whose lead was **won** by a first confirmed order
(CUSTOMERS-APP.md) — with their confirmed Vistaar business. Read-only: a customer is made
by an order and moved with the lead transfer (`POST /admin/leads/:piiId/transfer`,
LEADS-HO.md); there is nothing to create, edit or delete here.

| Method | Path | Returns |
|---|---|---|
| GET | `/admin/customers?q&agent_id&state&district&from&to&sort&page&limit` | `Page<AdminCustomer>`, latest order first |
| GET | `/admin/customers/summary` | `CustomerSummary` |
| GET | `/admin/customers/:piiId` | `AdminCustomerDetail` (404 if not a customer) |
| GET | `/admin/orders?customer=:piiId` | their orders (ORDERS-HO.md) |

Filters are `/admin/leads`'s (LEADS-HO.md); `sort` defaults to `-last_order_at`
(`created_at`, `last_order_at`, `next_follow_up`; `-` = newest first).

```ts
interface AdminCustomer extends LeadRow {      // LeadRow + partner: LEADS-HO.md
  orders: number;                              // confirmed orders, any Vistaar partner
  spend: number;                               // Σ their totals
  last_order_at: string | null;
  last_order_stage: "punched" | "shipped" | "delivered" | null;
}

interface AdminCustomerDetail extends AdminLeadDetail {   // + stage/activity/holder history
  orders: number; spend: number; last_order_at: string | null;
  last_order_stage: string | null; average_order: number;
}

interface CustomerSummary {
  total: number;
  active_30_days: number;     // ordered in the last 30 days
  new_this_month: number;     // won this IST month
  by_state: { key: string; count: number }[];   // top 10
}
```

Business counts confirmed orders (punched, shipped, delivered — not cancelled or
returned) with any Vistaar partner, so a transferred farmer keeps their history. Money
cards (order value) come from `GET /admin/orders/summary`.

One page = one leads read + one orders read (`orders_v2`'s `pii_id` index) — page with
`has_more`, never load the whole book in the browser.
