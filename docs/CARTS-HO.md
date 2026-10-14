# Carts and saved carts — HO portal contract

Head office **watches** what partners are about to buy: the cart a partner is
filling (`carts`, source `vistaar`) and the carts they saved for later
(`draft_orders`, entry path `vistaar`). Read-only — only the partner fills,
restores, orders or deletes one (CART-APP.md, DRAFT-ORDER-APP.md).
Capability `orders.read`, like `/admin/orders`.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/v2/admin/carts?agent_id=&page=&limit=` | `PageResult<AdminCartView>` — carts holding a product, last touched first |
| `GET` | `/api/v2/admin/draft-orders?agent_id=&page=&limit=` | `PageResult<AdminDraftOrderView>` — open saved carts, last saved first |

`agent_id` is a `VST-…` id (any case). `limit` ≤ 200.

```ts
interface Partner { agent_id: string; name: string | null; phone: string | null;
  cohort: string | null; district: string | null; state: string | null }

interface AdminCartView {
  partner: Partner;
  pii_id: string | null;          // null = the partner's own shop stock
  customer: { pii_id, name, phone, village, district } | null; // the farmer, from Leads
  items: { sku, product_name, product_image, size_label, price, quantity, line_total }[];
  item_count: number;             // Σ quantity
  subtotal: number;               // as stored — prices are the ones the partner last saw, not live
  updated_at: string | null;
}

interface AdminDraftOrderView {   // the app's DraftOrderView, plus the partner
  id: string;                     // DFT-n
  pii_id: string | null; contact_id: string | null;
  customer_name: string | null; contact_number: string | null;  // null = own stock
  items: { sku, product_name, product_image, size_label, price, mrp, quantity, line_total }[];
  item_count: number; subtotal: number;
  reminder_sent: boolean;         // the partner sent the WhatsApp reminder
  updated_at: string;
  partner: Partner;
}
```

A cart row names no partner (its `_id` is derived from theirs), so the list
is built from every partner's id — fine for hundreds of partners.
