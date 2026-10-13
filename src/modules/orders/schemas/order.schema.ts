import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type Types } from 'mongoose';

/**
 * `orders_v2` is **owned by Stockship** (`Stockship_V3_Backend`,
 * `modules/orders/schemas/order.schema.ts`) and shared with every channel
 * that sells: B2B, Prasar, franchise, KKD, marketplaces. This is a mirror of
 * that schema, every field Stockship declares (plus `extra_charges`, which
 * its writers set on live rows), so a Vistaar order is the same document as
 * everyone else's. This service only **reads** it.
 *
 * A Vistaar order is told apart by `source: 'vistaar'`, with the partner's
 * `VST-` id in `agent` (decided 2026-10-12). Every query here filters on both.
 *
 * No `index:` / `schema.index()` and `autoIndex: false` (CLAUDE.md rule 7):
 * Stockship owns the indexes. `{ agent, order_status, date }` already exists
 * and is the one these queries ride.
 */
export const ORDERS_COLLECTION = 'orders_v2';

const ADDRESS = {
  address_id: { type: String },
  first_name: { type: String },
  last_name: { type: String },
  phone: { type: String },
  email: { type: String },
  address1: { type: String },
  address2: { type: String },
  address3: { type: String },
  city: { type: String },
  pincode: { type: String },
  state: { type: String },
  state_code: { type: String },
  country: { type: String },
  country_code: { type: String },
};

export interface OrderAddress {
  address_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  pincode?: string;
  state?: string;
  state_code?: string;
  country?: string;
  country_code?: string;
}

export interface OrderItem {
  sku: string;
  qty: number;
  unit_price: number;
  total_price: number;
  is_combo?: boolean;
  is_free?: boolean;
  is_promotional?: boolean;
  item_discount?: string | number;
}

export interface OrderStatusEntry {
  stage_name?: string;
  timestamp?: Date;
  user?: string;
}

export interface OrderDiscount {
  discount_amount?: number;
  discount_code?: string;
  discount_percent?: number;
}

export interface OrderBookingDetails {
  awb_number?: string;
  previous_awb_number?: string[];
  child_awbs?: string[];
  is_cross_dock?: boolean;
  freight_charges_applied?: number;
  booking_courier?: string;
  shipping_label?: string;
  b2b_shipping_label?: string;
  pseudo_shipping_label?: string;
  delhivery_job_id?: string;
  delhivery_lr_number?: string;
  delhivery_doc_waybill?: string;
  ewaybill?: string;
  ewaybill_job_id?: string;
  courier_status?: string | null;
}

export interface OrderExtraCharges {
  delivery_charge?: number;
  small_cart_charge?: number;
  cod_charge?: number;
}

@Schema({
  collection: ORDERS_COLLECTION,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  autoIndex: false,
  // Other writers add fields (`extra_charges`, `return_booking`, `allocator`…);
  // a read must not drop them.
  strict: false,
})
export class Order {
  /** `KSK-341382`-style id, unique across every channel. */
  @Prop({ type: String, required: true })
  order_id!: string;

  /** When the order was placed — what Stockship sorts and filters by. */
  @Prop({ type: Date })
  date?: Date;

  /** The buyer: the farmer, or the partner's own `pii_id` for shop stock. */
  @Prop({ type: String })
  pii_id?: string;

  @Prop(
    raw({
      first_name: { type: String },
      last_name: { type: String },
      phone: { type: String },
      gst_number: { type: String },
    }),
  )
  customer?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    gst_number?: string;
  };

  @Prop({ type: String })
  customer_type?: string;

  @Prop(raw(ADDRESS))
  billing_address?: OrderAddress;

  @Prop(raw(ADDRESS))
  shipping_address?: OrderAddress;

  @Prop(raw({ ...ADDRESS, primary: { type: Boolean } }))
  alternate_address?: OrderAddress & { primary?: boolean };

  /** `cod` / `prepaid` / `partial` / `credit`. */
  @Prop({ type: String })
  payment_mode?: string;

  @Prop({ type: String })
  currency_code?: string;

  @Prop({ type: Number })
  exchange_rate?: number;

  @Prop(
    raw([
      {
        sku: { type: String },
        qty: { type: Number },
        unit_price: { type: Number },
        total_price: { type: Number },
        is_combo: { type: Boolean },
        is_free: { type: Boolean },
        is_promotional: { type: Boolean },
        item_discount: { type: String },
      },
    ]),
  )
  items?: OrderItem[];

  @Prop({ type: Number })
  total_weight?: number;

  @Prop({ type: Number })
  total_amount?: number;

  @Prop({ type: Number })
  original_total_amount?: number;

  @Prop({ type: Number })
  cod_amount?: number;

  @Prop({ type: Number })
  prepaid_amount?: number;

  @Prop(
    raw([
      {
        discount_amount: { type: Number },
        discount_code: { type: String },
        discount_percent: { type: Number },
      },
    ]),
  )
  discounts?: OrderDiscount[];

  @Prop({ type: Number })
  coin?: number;

  @Prop(
    raw({
      delivery_charge: { type: Number },
      small_cart_charge: { type: Number },
      cod_charge: { type: Number },
    }),
  )
  extra_charges?: OrderExtraCharges;

  /** `new_order` / `replacement_order` / `new_replacement_order` / `penalty_order`. */
  @Prop({ type: String })
  order_type?: string;

  /** `b2b` / `b2c`, in either case. */
  @Prop({ type: String })
  filter?: string;

  /** Not an enum in Stockship either: the stage set grows at runtime. */
  @Prop({ type: String })
  order_status?: string;

  @Prop(
    raw([
      {
        stage_name: { type: String },
        timestamp: { type: Date },
        user: { type: String },
      },
    ]),
  )
  order_status_map?: OrderStatusEntry[];

  @Prop({ type: String, default: null })
  marketplace?: string | null;

  /** `vistaar` for every order this service reads. */
  @Prop({ type: String })
  source?: string;

  @Prop({ type: String })
  sub_source?: string;

  /** The selling agent; on a Vistaar order, the partner's `VST-` id. */
  @Prop({ type: String })
  agent?: string | null;

  @Prop({ type: String })
  created_by?: string;

  @Prop({ type: String })
  invoice_number?: string;

  @Prop({ type: String })
  reference_id?: string;

  @Prop({ type: String })
  notes?: string;

  @Prop(
    raw({
      awb_number: { type: String },
      previous_awb_number: { type: [String] },
      child_awbs: { type: [String] },
      is_cross_dock: { type: Boolean },
      freight_charges_applied: { type: Number },
      booking_courier: { type: String },
      shipping_label: { type: String },
      b2b_shipping_label: { type: String },
      pseudo_shipping_label: { type: String },
      delhivery_job_id: { type: String },
      delhivery_lr_number: { type: String },
      delhivery_doc_waybill: { type: String },
      ewaybill: { type: String },
      ewaybill_job_id: { type: String },
      courier_status: { type: String },
    }),
  )
  booking_details?: OrderBookingDetails;

  @Prop(raw({ warehouse_id: { type: String } }))
  warehouse?: { warehouse_id?: string };

  @Prop(raw([{ courier: { type: String }, charge: { type: Number } }]))
  logistics_partner_rates?: { courier?: string; charge?: number }[];

  @Prop({ type: Boolean })
  by_csv?: boolean;

  @Prop({ type: String })
  go_invoice_number?: string;

  @Prop({ type: String })
  deal_id?: string;

  @Prop({ type: String })
  deal_code?: string;

  @Prop({ type: String })
  quotation_id?: string;

  @Prop(
    raw({
      bighaat_order_id: { type: String },
      version: { type: Number },
    }),
  )
  bighaat_order?: { bighaat_order_id?: string; version?: number };

  /** Never read here: Stockship hides it (`select: false`) too. */
  @Prop({ type: String, select: false })
  payment_screenshots?: string;

  @Prop(
    raw([
      {
        utr_number: { type: String },
        amount: { type: Number },
        bank_name: { type: String },
        timestamp: { type: Date },
        un_linked: { type: Boolean },
      },
    ]),
  )
  utr_infos?: {
    utr_number?: string;
    amount?: number;
    bank_name?: string;
    timestamp?: Date;
    un_linked?: boolean;
  }[];

  @Prop(
    raw([
      {
        sku: { type: String },
        qty: { type: Number },
        case_qty: { type: Number },
        is_promotional: { type: Boolean },
      },
    ]),
  )
  unpacked_items?: {
    sku: string;
    qty: number;
    case_qty?: number;
    is_promotional?: boolean;
  }[];

  @Prop(
    raw({
      tracking_timestamp: [{ status: { type: String }, date: { type: Date } }],
      last_tracking_time: { type: Date },
      being_tracked: { type: Boolean },
    }),
  )
  tracking_details?: {
    tracking_timestamp?: { status?: string; date?: Date }[];
    last_tracking_time?: Date;
    being_tracked?: boolean;
  };

  @Prop({ type: MongooseSchema.Types.ObjectId })
  outbound_order?: Types.ObjectId;

  @Prop(
    raw({
      attempted: { type: Boolean },
      condition: { type: String },
      validation_errors: { type: [String] },
    }),
  )
  auto_confirm?: {
    attempted?: boolean;
    condition?: string;
    validation_errors?: string[];
  };

  @Prop({ type: Boolean })
  mrv_check?: boolean;

  @Prop({ type: Boolean })
  rca?: boolean;

  @Prop(raw({ status: { type: Boolean }, orders: { type: [String] } }))
  merged?: { status?: boolean; orders?: string[] };

  @Prop(
    raw({
      status: { type: Boolean },
      message: { type: String },
      timestamp: { type: Date },
      user: { type: String },
    }),
  )
  is_customized?: {
    status?: boolean;
    message?: string;
    timestamp?: Date;
    user?: string;
  };

  @Prop(
    raw({
      status: { type: Boolean },
      chats: { type: MongooseSchema.Types.ObjectId },
    }),
  )
  is_mistake?: { status?: boolean; chats?: Types.ObjectId };

  @Prop(
    raw([
      {
        stage: { type: String },
        message: { type: String },
        user: { type: String },
        timestamp: { type: Date },
      },
    ]),
  )
  user_messages?: {
    stage: string;
    message?: string;
    user?: string;
    timestamp?: Date;
  }[];

  @Prop(
    raw([
      {
        type: { type: String },
        message: { type: [String] },
        timestamp: { type: Date },
      },
    ]),
  )
  failure_message?: { type?: string; message?: string[]; timestamp?: Date }[];

  @Prop(raw({ path: { type: String }, timestamp: { type: Date } }))
  provisional_invoice?: { path?: string; timestamp?: Date } | null;

  created_at?: Date;
  updated_at?: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

/** An order as `.lean()` returns it. */
export type OrderRecord = Order & { _id: Types.ObjectId };
