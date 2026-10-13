# Info pages — app contract

About Vistaar (`/about-program`), About Katyayani (`/about-company`) and
Contact Us (`/contact-us`) read their text from HO instead of the built-in
seed (`help_seed.dart` `programmeRules` / `supportContacts` /
`ticketCategories`, `content_seed.dart` `companyInfo`, and the strings written
into the three pages). The app keeps its layout and icons; every word, number
and list comes from here.

**Public** — no token needed, because Join Vistaar and the Need Help dialog can
show this before login. Limited to 600 reads a minute per IP.

| Route | Page |
|---|---|
| `GET /api/v2/about-program` | About Vistaar |
| `GET /api/v2/about-company` | About Katyayani |
| `GET /api/v2/contact-us` | Contact Us, and the Head Office numbers Need Help, Privacy and Feedback use |

Each answers `{ version, updated_at, content }`. An edit by HO reaches the app
within a minute. **404 `NOT_FOUND`** means HO has not created that page yet (or deleted it) —
keep showing the bundled seed text, as the Privacy page does.

## `GET /about-program`

```json
{
  "success": true,
  "data": {
    "version": 3,
    "updated_at": "2026-10-13T06:30:00.000Z",
    "content": {
      "hero": {
        "title": "Vistaar 2.0",
        "tagline": "Every partner is a Krishi Sahayak",
        "intro": "One partner app for everyone who sells Katyayani products — …"
      },
      "who_can_join": { "heading": "Who can join" },
      "earn": {
        "heading": "How you earn — two ways",
        "commission": { "title": "Commission on delivered orders", "body": "…" },
        "gigs": { "title": "Paid farmer-meeting gigs", "body": "…" },
        "no_payout": { "title": "No payout for adding people", "body": "…" },
        "referral": { "title": "Referral reward:", "body": "to be announced." }
      },
      "lifecycle": {
        "heading": "Commission lifecycle",
        "steps": [
          { "key": "pending", "title": "Pending", "body": "Created when the order is placed. …" },
          { "key": "confirmed", "title": "Confirmed", "body": "…" },
          { "key": "withdraw", "title": "Withdraw", "body": "Request any amount from {min_withdrawal}. …" }
        ],
        "reversed_note": "Reversed: Order was cancelled or returned — the commission is taken back."
      },
      "payouts": {
        "heading": "Payouts",
        "points": ["Minimum withdrawal {min_withdrawal} from your Withdrawable balance", "…"]
      },
      "rules": {
        "heading": "Programme rules",
        "items": [
          { "text": "One customer, one partner — …", "cohort": null },
          { "text": "Ex-employees cannot book orders …", "cohort": "ex_employee" }
        ],
        "sop": { "label": "Read the conflict-of-interest SOP", "sop_id": "sop5" }
      },
      "coins": {
        "heading": "Vistaar Coins",
        "headline": "1 coin = ₹1 off on your next order.",
        "body": "Earn coins on products you order … they cannot be withdrawn."
      },
      "more": {
        "heading": "More in the app",
        "items": [
          { "key": "testimonials", "title": "Farmer testimonials", "body": "…" },
          { "key": "grievances", "title": "Grievances", "body": "… within {grievance_sla_hours} hours." },
          { "key": "kkd_activity", "title": "KKD & App activity", "body": "…" }
        ]
      },
      "footer": "Powered by Katyayani Organics"
    }
  }
}
```

| Part | How the app draws it |
|---|---|
| `who_can_join` | Only the heading. The cards are the cohorts from `GET /onboarding/cohorts` (label, icon, sub-types for "And many more") |
| `earn` | Card 1 = `commission`, card 2 = `gigs`, red card = `no_payout`, the gift strip = `referral` (`title` bold, then `body`) |
| Commission slabs | Not here — they come with the wallet's commission plans |
| `lifecycle.steps[]` | In the order given. `key` picks the icon: `pending` cart, `confirmed` truck, `withdraw` wallet. The arrows go between them |
| `rules.items[]` | `cohort` is a cohort key or `null` (everyone). Highlight and show "Applies to you" when it is the partner's cohort; otherwise "For <cohort label>" |
| `rules.sop` | `null` hides the SOP link; else open SOP `sop_id` |
| `coins` | `headline` bold line; `body`, then the app appends "You have N coins." from the wallet |
| `more.items[]` | In the order given. `key` picks the icon and the screen: `testimonials`, `grievances`, `kkd_activity`. A key not in the list is not shown |
| Support card | Not here — the partner's own reporting officer, from their profile |

### Placeholders

HO's text may hold these; replace them before showing. The server refuses any
other `{…}`.

| Token | Replace with |
|---|---|
| `{min_withdrawal}` | The wallet's minimum withdrawal, as `formatINR` |
| `{grievance_sla_hours}` | The grievance SLA in hours (today `48`) |

The testimonials row no longer carries the "(x–y coins so far)" range; add it
after `body` if you still want it.

## `GET /about-company`

```json
{
  "version": 1,
  "updated_at": "2026-10-13T06:30:00.000Z",
  "content": {
    "name": "Katyayani Organics",
    "tagline": "Better inputs, better harvests — for every Indian farmer",
    "story": ["Katyayani Organics makes …", "We run our own …", "Vistaar brings partners …"],
    "mission": "Help farmers grow more with less — …",
    "stats": [{ "label": "Farmers served", "value": "10 lakh+" }],
    "what_we_make": [{ "title": "Bio stimulants", "text": "Humic & fulvic acid, …", "emoji": "🌱" }],
    "quality_points": ["In-house manufacturing and batch testing"],
    "ecosystem": [{ "title": "Katyayani Krishi Kendra", "text": "Stores for products, …", "emoji": "🏪" }],
    "contact": {
      "helpline": "1800-000-0000",
      "email": "vistaar@katyayaniorganics.com",
      "website": "https://katyayaniorganics.com"
    },
    "social": [{ "label": "YouTube", "url": "https://www.youtube.com/@katyayani" }]
  }
}
```

Same fields as the app's `CompanyInfo`, in snake_case. There is no `hoConfirm`
— text HO published is confirmed, so drop the "TO CONFIRM" tag when it comes
from here. Dial `contact.helpline` with non-digits removed (as today).

## `GET /contact-us`

```json
{
  "version": 2,
  "updated_at": "2026-10-13T06:30:00.000Z",
  "open_now": true,
  "content": {
    "helpline": { "number": "1800123456", "label": "1800-123-456" },
    "whatsapp": { "number": "9876543000", "label": "+91 98765 43000" },
    "support_email": "support@katyayaniorganics.com",
    "privacy_email": "privacy@katyayaniorganics.com",
    "play_store_url": "https://play.google.com/store/search?q=Katyayani%20Vistaar&c=apps",
    "hours": {
      "days": [1, 2, 3, 4, 5, 6],
      "opens": "10:00",
      "closes": "19:00",
      "label": "Mon – Sat, 10 AM – 7 PM · Sunday closed"
    },
    "ticket_categories": ["Order or delivery", "Commission or payout", "KYC or documents", "Product or agronomy query", "App problem", "Other"],
    "ticket_reply_note": "Head Office replies within 1 working day"
  }
}
```

| Field | Use |
|---|---|
| `helpline.number` / `whatsapp.number` | 10 digits: `tel:+91<number>`, `https://wa.me/91<number>`. Print `label` |
| `support_email` | The Email row (`mailto:` with subject `Vistaar <VST id>`) |
| `privacy_email` | Privacy page grievance address |
| `play_store_url` | Feedback "Rate us" |
| `open_now` | The Open now / Closed now pill — server clock, IST, worked out per request. Replaces `isOfficeOpen()` |
| `hours` | `label` is printed under the rows. `days` (ISO, 1 = Monday … 7 = Sunday), `opens`, `closes` (IST `HH:mm`, closes not included) if the app wants to recompute `open_now` while the screen stays open |
| `ticket_categories` | The ticket form's category dropdown |
| `ticket_reply_note` | Under "Raise a ticket", and in the toast after submitting |

Not here: the partner's officer and nearest Krishi Kendra (their profile), and
raising tickets (not built yet — the ticket list stays local).

Map with `SupportContacts`: `helpline` ← `helpline.number`, `helplineLabel` ←
`helpline.label`, and so on. NeedHelpDialog's hard-coded Head Office and
WhatsApp numbers should read from the same response.
