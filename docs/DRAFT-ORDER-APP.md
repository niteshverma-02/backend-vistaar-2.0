# Draft orders — mobile app contract

The partner's saved carts, for the Flutter app's **Saved Carts** screen and the
Cart screen's **Save for later**. Replaces the device-local
`SavedCartsRepository` (`/cart/saved` in the app's remote data source).

A draft is the active cart saved for one customer. **One open draft per
customer**: saving again for the same customer replaces it (same id). The
cart itself is not cleared by a save, and a draft stays after a restore — as
the app does today.

All routes are under `/api/v2/draft-orders` and answer
`{ "success": true, "data": … }`. Headers are the cart's
(`docs/CART-APP.md`): `Authorization: Bearer <Vistaar access token>` (whose drafts they are) and
`x-b2b-token` (the B2B token that prices the cart).

## Routes

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/draft-orders` | — | `DraftOrderView`: the active cart saved for its customer (set with `PUT /cart/customer`) |
| `GET` | `/draft-orders?page=1&limit=50` | — | `PageResult<DraftOrderView>`, newest first. `limit` ≤ 200 |
| `GET` | `/draft-orders/:id` | — | `DraftOrderView` |
| `POST` | `/draft-orders/:id/restore` | — | `CartView`: the cart now holds the draft's lines, for its customer |
| `POST` | `/draft-orders/:id/reminder` | — | `DraftOrderView` with `reminder_sent: true` (the app sends the WhatsApp itself) |
| `DELETE` | `/draft-orders/:id` | — | `{ "deleted": true }` |

`:id` is the draft's `DFT-n` id.

## `DraftOrderView`

```json
{
  "id": "DFT-96",
  "pii_id": "PII-1620690",
  "contact_id": "C0-201985",
  "customer_name": "Kishan Lal",
  "contact_number": "9876543210",
  "items": [
    {
      "sku": "K-350", "product_name": "Humic", "product_image": null,
      "size_label": "1 KG", "price": 245, "mrp": 320,
      "quantity": 3, "line_total": 735
    }
  ],
  "item_count": 3,
  "subtotal": 735,
  "reminder_sent": false,
  "updated_at": "2026-10-09T08:30:00.000Z"
}
```

- `customer_name` / `contact_number` `null` = the partner's own shop stock.
- `pii_id` (*added 2026-10-14*) = the farmer the draft is for — the same id as the cart,
  leads and customers; `null` = shop stock. Use it to show the draft on the farmer.
- `price` / `subtotal` are **as of the save**. Restore re-prices from the
  catalogue and caps quantities at today's stock; packs no longer sold are
  left out (the returned `CartView` shows what came back).
- Maps to the app's `SavedCart`: `items` → `item_count`, `value` → `subtotal`.

## Errors (`error.code`)

| Status | Code | When |
|---|---|---|
| 409 | `DRAFT_CART_EMPTY` | Save with an empty cart |
| 404 | `NOT_FOUND` | Draft not found / not yours / already ordered; or the cart's customer no longer exists or is not one of the partner's farmers (checked again on save and restore) |
| 503 | `DRAFT_ID_UNAVAILABLE` | Draft ids cannot be issued — retry later |
| 409 | `CART_BUSY` | Restore: the cart was changed on another device — retry |
| 401 | `UNAUTHORIZED` | Vistaar token or B2B token missing/expired |
