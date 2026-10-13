# 💰 Vistaar 2.0 commission: how it works

> **Sources:** PRD §5 and §9, the concept deck ("Earning model"), and the Flutter mock (`lib/features/wallet/domain/*`).
> **Status:** ⚠️ **DRAFT.** Rates, slab method and TDS still need sign-off (section 7).

---

## 1. ⚡ In 30 seconds

- A partner earns a **% of each delivered order**. The amount the % is taken on is the order value after discount and before GST.
- The % depends on a **slab**: the more the partner sells in a **calendar month**, the higher the %.
- The money moves **Pending → Confirmed (7 days after delivery) → Paid**. If the order is returned, the money is **Reversed**.
- The partner can withdraw from **₹500**. **TDS** is cut, and HO pays within **2 working days**.
- ❌ Nothing is paid for adding farmers or leads. Meeting gigs pay a separate flat ₹ amount.

---

## 2. 📏 The rules

| # | Rule |
|---|---|
| R1 | Commission is paid **only on delivered** orders |
| R2 | The amount the % is taken on = **price − GST − discount − coins**. Delivery fee is not included |
| R3 | The % comes from the **slab** for the partner type, based on **delivered sales in the calendar month (IST)** |
| R4 | Money becomes **Confirmed** after the **7-day return window**. Only confirmed money can be withdrawn |
| R5 | Cancelled or returned → **Reversed**. If the money was already paid → recovered from the next withdrawal (**clawback**) |
| R6 | Withdrawal **≥ ₹500** needs **KYC + a verified bank account + PAN** |
| R7 | **TDS (194H)** is cut from commission |
| R8 | **Coins** are not money and can't be withdrawn |

### Draft slabs (monthly delivered sales)

| Partner type | ₹0 – 50K | ₹50K – 1L | > ₹1L |
|---|---|---|---|
| Vistaar Agent | 5% | 7% | 10% |
| Ex-Employee | 5% | 7% | 10% |
| Working Professional | 5% | 7% | 7% |
| Agri Consultant | 6% | 8% | 8% |
| Other | 5% | 7% | 7% |

---

## 3. 🧮 The maths (only 3 formulas)

### ① What one order line earns commission on

```
amount = (price ÷ (1 + GST%)) − discount − coins
```

**Example:** a ₹1,180 line with 18% GST, ₹50 discount and ₹50 of coins: ₹1,000 − 50 − 50 = **₹900**.

### ② Total commission for the month, `M(sales)`

Two possible methods; pick one (decision D3):

| Method | How | ₹1,20,000 of sales |
|---|---|---|
| **Retro** | The whole month gets the top slab's % | 1,20,000 × 10% = **₹12,000** |
| **Incremental** ✅ | Each part gets its own slab's % (like income-tax slabs) | 2,500 + 3,500 + 2,000 = **₹8,000** |

### ③ ⭐ What each order adds

```
credit = M(sales after this order) − M(sales before it)
```

- The credits always **add up to the month's correct total**, so nothing needs to be recalculated at month end.
- For a return the same formula works in reverse, and the credit comes out negative.
- The checkout estimate uses the same formula, and the app shows it as "≈ estimate".

---

## 4. 📊 One month, worked example

Vistaar Agent, October, **incremental**:

| Event | Sales before → after | Credit |
|---|---|---|
| Order A delivered (₹30,000) | 0 → 30,000 | **+₹1,500** |
| Order B delivered (₹40,000) | 30,000 → 70,000 | **+₹2,400** |
| Order C delivered (₹50,000) | 70,000 → 1,20,000 | **+₹4,100** |
| ₹10,000 of C returned | 1,20,000 → 1,10,000 | **−₹1,000** |
| **Total** | | **₹7,000** ✅ (equals M(1,10,000)) |

### Why incremental is better

| Sales | Retro | Incremental |
|---|---|---|
| ₹1,01,000 | ₹10,100 | ₹6,100 |
| ₹2,000 returned → ₹99,000 | ₹6,930 | ₹5,930 |
| **Lost on a small return** | ❌ **₹3,170** | ✅ **₹170** |

Under retro, one small return drops the partner a slab and a big amount is lost. That causes disputes.

---

## 5. 🔄 What happens to the money

```
Delivered ──► PENDING ──(7 days)──► CONFIRMED ──(HO pays)──► PAID
                 │                     │                      │
              returned              returned               returned
                 ▼                     ▼                      ▼
             REVERSED              REVERSED           CLAWBACK (from next withdrawal)
```

**TDS (draft, Finance confirms):** none below the yearly limit; 2% with PAN; 20% without PAN.
**Example:** withdraw ₹1,000 → ₹20 TDS → **₹980** in the bank.

---

## 6. 🛡️ Safety (for 20M users)

| Risk | Fix |
|---|---|
| The same order event arrives twice | Each event has a fixed ID, so the second one is ignored |
| Many orders delivered at the same moment | Month sales are updated in **one atomic step**, so the totals stay correct |
| The same money withdrawn twice | Money is locked to one withdrawal |
| Rates change mid-month | A new plan applies only **from the next month** |
| All money in paise | No rounding errors |

---

## 7. 📋 Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D2 | Final rates per partner type | Sign off the section 2 table |
| **D3** | **Retro or incremental** | ✅ **Incremental** |
| — | Which month an order counts in | Delivery month (IST) |
| — | Should coins reduce the amount? | Yes |
| — | Clawback after payment? | Yes, from the next withdrawal |
| — | Orders for the partner's own shop | Lower % or a monthly cap |
| D7 | Withdrawal minimum | ₹500, weekly |
| — | TDS rate, threshold and timing | **Finance** decides |
| D13 | Farmers' own app orders | No commission at launch |

---

## 8. ⚠️ Problems in the current app logic

| Problem | Fix |
|---|---|
| The % is locked at checkout, but the slab depends on the whole month | Formula ③; checkout shows only an estimate |
| GST is not removed (5–18% overpaid) | Formula ① |
| Partial returns not handled | Calculate per order line |
| No recovery after payout | Clawback |
| Retro cliff | Incremental |
| Gig money mixed in with commission | Keep gigs as separate entries |

---

## 9. 🏗️ Backend plan

| Collection | Holds |
|---|---|
| `vistaar_v2_commission_plans` | Slabs + method per partner type, per month |
| `vistaar_v2_commission_entries` | One row per order line event: amount, credit, status |
| `vistaar_v2_commission_months` | Each partner's sales per month |
| `vistaar_v2_withdrawals` | Withdrawal requests, TDS, payout, UTR |

`orders_v2` is **read-only**; commission never writes to it.

| Job | When | Does |
|---|---|---|
| Order sync | Every few minutes | Turns new delivered / returned orders into entries |
| Daily confirm | Daily | Pending → Confirmed after 7 days |
| Month-end check | 1st of the month | Checks the month's total is correct |

---

## 10. 🛣️ Build steps

1. ✅ Check the PRD and the app logic (this doc)
2. 📋 **Jahpana + Finance** sign off D2, D3 and TDS
3. 🗄️ Build the collections and the HO plan editor
4. ⚙️ Build the engine (the 3 formulas) + jobs, with unit tests
5. 📱 Connect the Wallet screens to the real API
6. 🧪 Test: slab crossing, partial return, return after payout, duplicate event, 50 orders at the same moment, two withdrawals at once, an order placed in October and delivered in November
