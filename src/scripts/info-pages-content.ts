/**
 * The info-page text the app shipped as seed data, as version 1 of each page.
 * Used by `seed-info-pages.ts`; `info-pages-content.spec.ts` keeps it valid.
 */
import type {
  AboutCompanyContent,
  AboutProgramContent,
  ContactUsContent,
} from '../modules/info-pages/info-pages.domain';

export const ABOUT_PROGRAM: AboutProgramContent = {
  hero: {
    title: 'Vistaar 2.0',
    tagline: 'Every partner is a Krishi Sahayak',
    intro:
      'One partner app for everyone who sells Katyayani products — order for farmers or your own shop, run paid farmer meetings, and earn on every delivered order.',
  },
  who_can_join: { heading: 'Who can join' },
  earn: {
    heading: 'How you earn — two ways',
    commission: {
      title: 'Commission on delivered orders',
      body: 'Every partner places orders and earns a % of the order value once it is delivered and not returned. Slabs below.',
    },
    gigs: {
      title: 'Paid farmer-meeting gigs',
      body: 'Pick a meeting posted by HO or your Prasar Officer → check in with GPS at the venue → mark farmer attendance → upload photos. Paid per completed meeting after HO verifies it.',
    },
    no_payout: {
      title: 'No payout for adding people',
      body: 'Adding dealers, farmers or leads does not earn anything by itself — only their delivered orders do.',
    },
    referral: { title: 'Referral reward:', body: 'to be announced.' },
  },
  lifecycle: {
    heading: 'Commission lifecycle',
    steps: [
      {
        key: 'pending',
        title: 'Pending',
        body: 'Created when the order is placed. Shown in your Pending balance.',
      },
      {
        key: 'confirmed',
        title: 'Confirmed',
        body: 'Order delivered and the 7-day return window is over. Moves to Withdrawable.',
      },
      {
        key: 'withdraw',
        title: 'Withdraw',
        body: 'Request any amount from {min_withdrawal}. Marked Paid once it reaches your bank.',
      },
    ],
    reversed_note:
      'Reversed: Order was cancelled or returned — the commission is taken back.',
  },
  payouts: {
    heading: 'Payouts',
    points: [
      'Minimum withdrawal {min_withdrawal} from your Withdrawable balance',
      'HO approves requests within 2 working days; paid to your verified bank account or UPI',
      'TDS is deducted as per law — keep your PAN updated to avoid a higher rate',
      'Every payout shows a UTR number in Wallet → Withdrawals',
    ],
  },
  rules: {
    heading: 'Programme rules',
    items: [
      {
        text: 'One customer, one partner — a farmer or shop is linked to the first partner who adds them.',
        cohort: null,
      },
      {
        text: 'Ex-employees cannot book orders for customers they handled at Katyayani in the last 12 months.',
        cohort: 'ex_employee',
      },
      {
        text: 'Working professionals must keep an employer / no-conflict declaration current.',
        cohort: 'other_company_employee',
      },
      {
        text: 'Agri consultants must link every order to an advisory or agronomy ticket.',
        cohort: 'consultant',
      },
      {
        text: 'Returns: unopened packs only, within 7 days of delivery. Commission on returned items is reversed.',
        cohort: null,
      },
    ],
    sop: { label: 'Read the conflict-of-interest SOP', sop_id: 'sop5' },
  },
  coins: {
    heading: 'Vistaar Coins',
    headline: '1 coin = ₹1 off on your next order.',
    body: 'Earn coins on products you order and on farmer testimonials HO approves. Coins are a discount, not cash — they cannot be withdrawn.',
  },
  more: {
    heading: 'More in the app',
    items: [
      {
        key: 'testimonials',
        title: 'Farmer testimonials',
        body: "Record a farmer's photo, video or words about a product. Earns coins once HO approves.",
      },
      {
        key: 'grievances',
        title: 'Grievances',
        body: 'Raise a complaint about an order, payment or product. It goes to your Prasar agent, who must respond within {grievance_sla_hours} hours.',
      },
      {
        key: 'kkd_activity',
        title: 'KKD & App activity',
        body: "See your farmers' Krishi Kendra walk-ins and store orders, plus their Katyayani app activity, so you know whom to follow up.",
      },
    ],
  },
  footer: 'Powered by Katyayani Organics',
};

export const ABOUT_COMPANY: AboutCompanyContent = {
  name: 'Katyayani Organics',
  tagline: 'Better inputs, better harvests — for every Indian farmer',
  story: [
    'Katyayani Organics makes crop-nutrition, bio-stimulant and crop-protection products and sells them directly to farmers across India.',
    'We run our own manufacturing and R&D, a network of Katyayani Krishi Kendra stores, the Katyayani farmer app, and field teams (Prasar officers) who meet farmers in their villages.',
    'Vistaar brings partners — Krishi Sahayaks — into this network so that good products and advice reach every village.',
  ],
  mission:
    'Help farmers grow more with less — through the right product, the right dose and the right advice at the right time.',
  stats: [
    { label: 'Farmers served', value: '10 lakh+' },
    { label: 'Products', value: '300+' },
    { label: 'States', value: '20+' },
    { label: 'Krishi Kendra stores', value: '50+' },
  ],
  what_we_make: [
    {
      title: 'Bio stimulants',
      text: 'Humic & fulvic acid, seaweed extract, amino acids',
      emoji: '🌱',
    },
    {
      title: 'Nutrition',
      text: 'Water-soluble NPK, chelated micronutrients',
      emoji: '🧪',
    },
    {
      title: 'Crop protection',
      text: 'Insecticides, fungicides, herbicides, botanicals',
      emoji: '🛡️',
    },
    {
      title: 'Bio products',
      text: 'Trichoderma and other biologicals',
      emoji: '🦠',
    },
  ],
  quality_points: [
    'In-house manufacturing and batch testing',
    'Registered products with label claims and dosage guidance',
    'Agronomy team answers farmer problems within 48 hours',
  ],
  ecosystem: [
    {
      title: 'Katyayani Krishi Kendra',
      text: 'Stores for products, soil tests and advice',
      emoji: '🏪',
    },
    {
      title: 'Katyayani farmer app',
      text: 'Farmers order and learn on their phone',
      emoji: '📱',
    },
    {
      title: 'Prasar officers',
      text: 'Field team that supports you and runs meetings',
      emoji: '🧑‍💼',
    },
    {
      title: 'Vistaar · Krishi Sahayak',
      text: 'Partners who bring Katyayani to every village',
      emoji: '🤝',
    },
  ],
  contact: {
    helpline: '1800-000-0000',
    email: 'vistaar@katyayaniorganics.com',
    website: 'https://katyayaniorganics.com',
  },
  social: [
    { label: 'YouTube', url: 'https://www.youtube.com/' },
    { label: 'Instagram', url: 'https://www.instagram.com/' },
    { label: 'Facebook', url: 'https://www.facebook.com/' },
  ],
};

export const CONTACT_US: ContactUsContent = {
  helpline: { number: '1800123456', label: '1800-123-456' },
  whatsapp: { number: '9876543000', label: '+91 98765 43000' },
  support_email: 'support@katyayaniorganics.com',
  privacy_email: 'privacy@katyayaniorganics.com',
  play_store_url:
    'https://play.google.com/store/search?q=Katyayani%20Vistaar&c=apps',
  hours: {
    days: [1, 2, 3, 4, 5, 6],
    opens: '10:00',
    closes: '19:00',
    label: 'Mon – Sat, 10 AM – 7 PM · Sunday closed',
  },
  ticket_categories: [
    'Order or delivery',
    'Commission or payout',
    'KYC or documents',
    'Product or agronomy query',
    'App problem',
    'Other',
  ],
  ticket_reply_note: 'Head Office replies within 1 working day',
};
