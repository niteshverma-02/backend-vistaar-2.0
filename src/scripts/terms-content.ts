/**
 * Every partner-facing rule the app shipped as built-in text, as the first
 * editor-made Vistaar Privacy & Terms: help_seed.dart (privacy policy, partner
 * terms, programme rules), privacy_page.dart (data and deletion requests),
 * step_doc_config.dart (Partner Agreement s10, Employer No-Conflict
 * Declaration s8), about_program_page.dart (payouts, coins; minimum
 * withdrawal ₹500 and grievance reply 48 h from the app's seed). Used by
 * `seed-terms.ts`; Legal must read it before launch.
 */
import type { ComposeTermsDto } from '../modules/terms/dto/terms.dto';

const s = (
  heading: string,
  part: {
    body?: string;
    points?: string[];
    items?: [string, string, string?][];
  },
) => ({
  heading,
  body: part.body ?? null,
  points: part.points ?? [],
  items: (part.items ?? []).map(([title, detail, purpose]) => ({
    title,
    detail,
    purpose: purpose ?? null,
  })),
});

export const VISTAAR_TERMS: ComposeTermsDto = {
  title: 'Vistaar Privacy & Terms',
  intro:
    'Privacy Policy and Partner Terms between Katyayani Organics and its Vistaar partners (Krishi Sahayaks). A partner accepts them by e-signing the Vistaar Partner Agreement during onboarding. Last updated: 30 September 2026.',
  sections: [
    s('Privacy Policy', {
      body: 'Katyayani Organics never sells your data. This notice follows the Digital Personal Data Protection Act, 2023.',
    }),
    s('What we collect and why', {
      items: [
        [
          'Identity',
          'Name, mobile, email, photo, Aadhaar (last 4 digits only) and PAN',
          'To verify you and deduct TDS on commission',
        ],
        ['Bank', 'Account number, IFSC, UPI ID', 'To pay your commission'],
        [
          'Location',
          'Address; GPS only when you punch attendance or log a visit',
          'To map your franchise and record field work',
        ],
        [
          'Business',
          'Orders, customers and leads you add, app usage',
          'To process orders, calculate commission and support you',
        ],
      ],
    }),
    s('Who we share it with', {
      body: 'Only with the Katyayani franchise that delivers your orders, courier partners (delivery address and phone), our payout bank (for commission), and government bodies where the law requires it (for example TDS filings).',
    }),
    s('How long we keep it', {
      body: 'While you are a partner, and after you leave only for as long as tax and accounting law requires. KYC images are deleted once they are no longer legally needed.',
    }),
    s('Your rights', {
      body: 'You can see, correct or ask us to erase your data, and withdraw consent at any time. Erasure closes your partner account; confirmed commission is paid out first.',
      points: [
        'My data: ask for a copy from Privacy & Terms in the app. We email it to your registered contact within 7 days.',
        'Delete account: ask from Privacy & Terms in the app. Your reporting officer calls to confirm within 2 working days. Pending orders are completed and confirmed commission is paid before the account is closed.',
      ],
    }),
    s('Grievance officer', {
      body: 'Katyayani Organics — for privacy questions and complaints: privacy@katyayaniorganics.com',
    }),
    s('Partner terms — summary', {
      points: [
        'You earn commission only on orders delivered to the customer. Cancelled or returned orders earn nothing.',
        'There is no payment for adding farmers, dealers, leads or other partners.',
        'Ordering unlocks after KYC is verified and Product Knowledge L1 is passed.',
        'Recommend products only for labelled crops and doses.',
        'Customer data you add must be used only to serve that customer.',
        'The full Vistaar Partner Agreement is e-signed during onboarding and is available under KYC & documents.',
      ],
    }),
    s('Vistaar Partner Agreement', {
      points: [
        'Commission is earned only on orders that are delivered to the customer. Orders that are cancelled, returned or undelivered earn nothing, and any commission already shown for them is reversed.',
        'Commission stays pending until delivery plus the 7-day return window, then becomes confirmed and withdrawable.',
        'There is no payment of any kind for adding farmers, dealers, leads or other partners to the app.',
        'Commission rates follow the slab for your partner type and monthly delivered sales, as published in the app. Katyayani may revise slabs with 15 days notice in the app.',
        'TDS is deducted on commission under Section 194H. Without a valid PAN, TDS is deducted at the higher rate.',
        'Payouts go only to the verified bank account or UPI ID in your own name.',
        'You will recommend products only for their labelled crops and doses, and will not make claims beyond the label.',
        'You will not collect cash from customers on behalf of Katyayani beyond the order value shown in the app.',
        'Customer data you add is used only to serve that customer. You will not share it outside Vistaar.',
        'Either party may end this agreement with 30 days notice. Confirmed commission up to the end date is paid out.',
      ],
    }),
    s('Employer No-Conflict Declaration (working professionals)', {
      body: 'A partner who is employed elsewhere also e-signs this declaration:',
      points: [
        'I am currently employed with the employer named above and my role does not involve selling competing agri-input products.',
        'My employment terms do not prohibit me from earning commission as an independent partner.',
        "I will not use my employer's time, customer lists, data or assets to place Vistaar orders.",
        'I will inform Katyayani within 7 days if my employer, role or any of the above changes.',
        'If a conflict is found, Katyayani may pause my account and reverse commission on affected orders.',
      ],
    }),
    s('Commission and payouts', {
      points: [
        'Pending: created when the order is placed and shown in your Pending balance.',
        'Confirmed: the order is delivered and the 7-day return window is over; it moves to Withdrawable.',
        'Reversed: the order was cancelled or returned — the commission is taken back.',
        'Minimum withdrawal ₹500 from your Withdrawable balance.',
        'HO approves requests within 2 working days; paid to your verified bank account or UPI.',
        'TDS is deducted as per law — keep your PAN updated to avoid a higher rate.',
        'Every payout shows a UTR number in Wallet → Withdrawals.',
      ],
    }),
    s('Programme rules', {
      points: [
        'One customer, one partner — a farmer or shop is linked to the first partner who adds them.',
        'Ex-employees cannot book orders for customers they handled at Katyayani in the last 12 months.',
        'Working professionals must keep an employer / no-conflict declaration current.',
        'Agri consultants must link every order to an advisory or agronomy ticket.',
        'Returns: unopened packs only, within 7 days of delivery. Commission on returned items is reversed.',
        'Grievances about an order, payment or product go to your Prasar agent, who must respond within 48 hours.',
      ],
    }),
    s('Vistaar Coins', {
      body: '1 coin = ₹1 off on your next order. Earn coins on products you order and on farmer testimonials HO approves. Coins are a discount, not cash — they cannot be withdrawn.',
    }),
  ],
};
