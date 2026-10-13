# Info pages — HO portal contract

The text of three app pages, each edited as one form: **About Vistaar**
(`about-program`), **About Katyayani** (`about-company`) and **Contact Us**
(`contact-us`, which also holds the Head Office numbers the app's Need Help,
Privacy and Feedback screens use). These routes need the company SSO token.
Gate screens and buttons on these capabilities from `GET /admin/me`:

| Capability | Allows |
|---|---|
| `content.read` | Open a page |
| `content.write` | Save a page |

The app sees a change within a minute.

## Routes

Each page has its own four routes. `<page>` is `about-program`,
`about-company` or `contact-us`, under `/api/v2/admin/<page>`:

| Method | Path | Capability | Does |
|---|---|---|---|
| `GET` | `/admin/<page>` | `content.read` | The page as saved. **404** = not created yet |
| `POST` | `/admin/<page>` | `content.write` | Create it. Body: the page's **whole** content (fields below), all required. **409 `INFO_PAGE_EXISTS`** if it is already there |
| `PATCH` | `/admin/<page>` | `content.write` | Edit. Body: `version` (the one you loaded, required) + any of the page's top-level fields. Each field sent **replaces that whole part** (e.g. send all of `stats[]`, not one stat); fields not sent stay |
| `DELETE` | `/admin/<page>` | `content.write` | Delete → `{ "deleted": true }`. The app goes back to its built-in text until the page is created again |

`GET`, `POST` and `PATCH` answer the stored row:

```json
{
  "_id": "contact_us",
  "content": { "…": "the page's fields, below" },
  "version": 4,
  "created_by": "seed:info-pages",
  "updated_by": "ho@katyayaniorganics.com",
  "created_at": "2026-10-13T06:30:00.000Z",
  "updated_at": "2026-10-13T09:10:00.000Z"
}
```

`version` is 1 on create and +1 on each edit.

```json
PATCH /api/v2/admin/contact-us
{ "version": 4, "ticket_reply_note": "Head Office replies within 4 working hours" }
```

**409 `VERSION_CONFLICT`** — someone saved the page after you opened it.
Nothing was written. Reload, show the newer text, and let them redo the change.

**400 `VALIDATION_FAILED`** — `details[]` lists every problem; `message` is the
first one, ready to show. An edit is checked as the whole page after it.

## About Vistaar — `content`

| Field | Rule |
|---|---|
| `hero.title`, `hero.tagline` | 1–120 chars |
| `hero.intro` | 1–1000 chars |
| `who_can_join.heading` | 1–120. The cards themselves are the cohorts (Cohorts screen) |
| `earn.heading` | 1–120 |
| `earn.commission`, `earn.gigs`, `earn.no_payout`, `earn.referral` | Each `{ title 1–120, body 1–1000 }`. For `referral`, `title` is the bold part ("Referral reward:") |
| `lifecycle.heading` | 1–120 |
| `lifecycle.steps[]` | 1–3 of `{ key, title, body }`, in display order. `key` is `pending`, `confirmed` or `withdraw` (the app's icon); each at most once |
| `lifecycle.reversed_note` | 1–1000 — the red note under the steps |
| `payouts.heading`, `payouts.points[]` | Up to 30 points, each 1–1000 |
| `rules.heading`, `rules.items[]` | Up to 30 `{ text 1–1000, cohort }`. `cohort` is an existing cohort key (switched-off is fine), or `null` for everyone |
| `rules.sop` | `{ label 1–120, sop_id }` or `null` to hide the link |
| `coins.heading`, `coins.headline` | 1–120 |
| `coins.body` | 1–1000. The app adds "You have N coins." after it |
| `more.heading`, `more.items[]` | Up to 3 `{ key, title, body }`; `key` is `testimonials`, `grievances` or `kkd_activity` (the screen the row opens); each at most once. Leave one out to hide that row |
| `footer` | 1–120 |

Commission slabs and the partner's officer are not on this form — they come
from the wallet's commission plans and the partner's profile.

### Placeholders

Two values change on their own, so write a token and the app fills it in:

| Token | Becomes |
|---|---|
| `{min_withdrawal}` | The minimum withdrawal, e.g. ₹500 |
| `{grievance_sla_hours}` | The grievance reply time in hours, e.g. 48 |

Any other `{…}` in any field is refused. Show the two tokens as insert buttons
beside the text boxes.

## About Katyayani — `content`

| Field | Rule |
|---|---|
| `name`, `tagline` | 1–120 |
| `story[]` | Up to 10 paragraphs, each 1–1000 |
| `mission` | 1–1000 |
| `stats[]` | Up to 8 `{ label 1–60, value 1–30 }` — `value` is text ("10 lakh+") |
| `what_we_make[]`, `ecosystem[]` | Up to 30 tiles `{ title 1–120, text 1–400, emoji 1–16 }` |
| `quality_points[]` | Up to 30, each 1–400 |
| `contact` | `{ helpline 3–30 (printed as typed), email, website (https) }` |
| `social[]` | Up to 10 `{ label 1–40, url (https) }` |

## Contact Us — `content`

| Field | Rule |
|---|---|
| `helpline`, `whatsapp` | `{ number, label }`. `number` is exactly 10 digits, no `+91` or spaces (the app adds `+91`). `label` 1–30 is how it is printed ("1800-123-456") |
| `support_email` | Email — the Contact Us email row |
| `privacy_email` | Email — the Privacy page's grievance address |
| `play_store_url` | https — Feedback's "Rate us" |
| `hours.days` | 1–7 distinct ISO weekdays: 1 = Monday … 7 = Sunday |
| `hours.opens`, `hours.closes` | `HH:mm`, 24-hour, IST; closing after opening. Drives the app's Open now / Closed now |
| `hours.label` | 1–120 — printed as typed, so keep it in step with the times |
| `ticket_categories[]` | 1–30, each 1–60 — the ticket form's dropdown |
| `ticket_reply_note` | 1–120 — "Head Office replies within 1 working day" |
