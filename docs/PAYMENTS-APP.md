# Payment options — mobile app

The Pay online screen's list of payment apps (Razorpay, Cashfree, PhonePe),
switched on by HO in the portal. Replaces `payment_gateways_seed.dart`.

## `GET /api/v2/payment-options`

Partner token. No query.

```json
{ "success": true,
  "data": [
    { "id": "razorpay", "provider": "razorpay", "label": "Razorpay", "hint": "UPI, cards, net banking" },
    { "id": "phonepe",  "provider": "phonepe",  "label": "PhonePe",  "hint": "PhonePe or any UPI app" }
  ] }
```

- Only options HO switched on for the partner's cohort, already in display order — show them as sent, first one selected.
- `provider` is one of `razorpay` / `cashfree` / `phonepe` (the app's `PaymentProvider.wire`). An unknown value means a newer server: skip that row.
- `hint` may be `null`.
- **Empty list = online payment is off.** Keep "Online (UPI)" disabled, as today on a failed load. It is empty while the server's kill switch is off, whatever HO set.
- HO changes reach the app within a minute. Load once per Checkout, as `PaymentGatewaysCubit` does.

## What this is not

The list only decides what the app **shows**. It takes no payment and carries no
merchant key. Taking the money (gateway order, verify, webhook) is a separate
API, not built yet; when it is, the server re-checks the option is still on and
works out the amount itself — the app never sends an amount to be charged.
