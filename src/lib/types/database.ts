/**
 * Crazyshot Database TypeScript Types
 * Schema Version: v5.46
 * Date: 2026-05-29
 *
 * Comprehensive type definitions for all 24+ tables, enums, and RPC functions.
 * Mirrors PostgreSQL schema exactly — used for Supabase client type safety.
 *
 * Modules:
 *   M1 - Products (products, assets, price_rules, product_options, pickup_points, cart_items)
 *   M2 - Reservations (rental_reservations)
 *   M3 - Orders & Payments (orders, order_reservations, payment_transactions)
 *   M4 - Membership (user_profiles, subscriptions, coupons, user_coupons, deposit_holds, credit_score_audit)
 *   M5 - Shipment & Inspection (shipments, asset_inspections, contracts)
 *   Support (notification_tokens, notification_logs, cs_posts, cs_inquiries, public_holidays, late_fees, foreign_users)
 */

// =============================================================================
// ★ ENUM TYPES
// =============================================================================

export type ProductCategoryEnum =
  | 'camera' | 'lens' | 'camcorder' | 'action_cam' | 'drone'
  | 'lighting' | 'audio' | 'accessory' | 'package';

export type AssetStatusEnum =
  | 'available' | 'rented' | 'hold' | 'maintenance' | 'retired' | 'inspection';

export type DurationTypeEnum = '12h' | '24h' | 'purchase' | 'monthly';

export type ReservationStatusEnum =
  | 'hold' | 'confirmed' | 'in_use' | 'returned'
  | 'cancelled' | 'overdue' | 'damaged' | 'disputed';

export type PaymentStatusEnum =
  | 'pending' | 'completed' | 'failed' | 'refunded' | 'partial_refund';

export type ShipmentMethodEnum =
  | 'crazydelivery' | 'quick' | 'locker' | 'visit' | 'airport';

export type ShipmentStatusEnum =
  | 'preparing' | 'shipped' | 'in_transit' | 'delivered' | 'pickup_ready' | 'failed';

export type MembershipGradeEnum = 'none' | 'easy' | 'pop' | 'crazy' | 'admin';

export type CouponTypeEnum = 'all' | 'first_purchase' | 'student' | 'subscription';

export type OptionTypeEnum = 'accessory' | 'service' | 'bundle';

export type ContractStatusEnum = 'active' | 'completed' | 'cancelled';

export type InspectionTypeEnum = 'pre_rental' | 'post_rental';

export type SubscriptionStatusEnum = 'active' | 'cancelled' | 'expired' | 'paused';

// =============================================================================
// ★ JSON helper
// =============================================================================

export type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[];

// =============================================================================
// ★ M1: PRODUCT MODULE
// =============================================================================

export interface Product {
  id: string;                          // UUID PK
  category: ProductCategoryEnum;
  name: string;                        // VARCHAR(200)
  slug: string;                        // VARCHAR(200) UNIQUE
  brand: string | null;                // VARCHAR(100)
  description: string | null;
  image_urls: string[];                // text[]
  specifications: Json | null;         // JSONB
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type ProductInsert = Omit<Product, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
export type ProductUpdate = Partial<ProductInsert>;

// ───────────────────────────────────────────────────────────
export interface Asset {
  id: string;                          // UUID PK
  product_id: string;                  // FK products.id
  asset_code: string;                  // VARCHAR(50) UNIQUE
  serial_number: string | null;
  status: AssetStatusEnum;
  condition_notes: string | null;
  purchase_date: string | null;        // date
  last_maintenance_date: string | null;
  next_maintenance_date: string | null;
  maintenance_interval_days: number;
  is_insured: boolean;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  warehouse_location: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type AssetInsert = Omit<Asset, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
export type AssetUpdate = Partial<AssetInsert>;

// ───────────────────────────────────────────────────────────
export interface PriceRule {
  id: string;                          // UUID PK
  product_id: string;                  // FK products.id
  duration_type: DurationTypeEnum;
  price: number;                       // NUMERIC(10,2)
  deposit_amount: number;              // NUMERIC(10,2)
  late_fee_per_hour: number;
  damage_fee_percentage: number;
  is_active: boolean;
  effective_from: string;              // timestamptz
  effective_to: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type PriceRuleInsert = Omit<PriceRule, 'id' | 'created_at' | 'updated_at'> & {
  id?: string; created_at?: string; updated_at?: string;
};
export type PriceRuleUpdate = Partial<PriceRuleInsert>;

// ───────────────────────────────────────────────────────────
export interface ProductOption {
  id: string;                          // UUID PK
  product_id: string;                  // FK products.id
  option_type: OptionTypeEnum;
  name: string;
  description: string | null;
  price: number;
  stock_quantity: number;
  is_required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type ProductOptionInsert = Omit<ProductOption, 'id' | 'created_at' | 'updated_at'> & {
  id?: string; created_at?: string; updated_at?: string;
};
export type ProductOptionUpdate = Partial<ProductOptionInsert>;

// ───────────────────────────────────────────────────────────
export interface PickupPoint {
  id: string;                          // UUID PK
  name: string;
  location: string;
  address: string;
  phone: string;
  operating_hours: Json | null;        // JSONB
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ───────────────────────────────────────────────────────────
export interface CartItem {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  product_id: string;                  // FK products.id
  asset_id: string | null;             // FK assets.id
  duration_type: DurationTypeEnum;
  quantity: number;
  rental_start_date: string;           // date
  rental_end_date: string;             // date
  selected_options: string[];          // UUID[] FK product_options.id
  zone: 1 | 2 | 3 | 4;               // Zone 1~4
  created_at: string;
  updated_at: string;
}

export type CartItemInsert = Omit<CartItem, 'id' | 'created_at' | 'updated_at'> & {
  id?: string; created_at?: string; updated_at?: string;
};
export type CartItemUpdate = Partial<CartItemInsert>;

// =============================================================================
// ★ M2: RENTAL RESERVATION MODULE
// =============================================================================

export interface RentalReservation {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  asset_id: string;                    // FK assets.id
  order_id: string | null;             // FK orders.id (post-checkout)
  status: ReservationStatusEnum;
  rental_start_date: string;           // date
  rental_end_date: string;             // date
  actual_pickup_date: string | null;
  actual_return_date: string | null;
  pickup_method: ShipmentMethodEnum;
  return_method: ShipmentMethodEnum;
  pickup_point_id: string | null;      // FK pickup_points.id
  return_point_id: string | null;      // FK pickup_points.id
  hold_expiration_at: string | null;   // timestamptz — 10분 hold 만료
  damage_reported: boolean;
  damage_notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type RentalReservationInsert = Omit<RentalReservation, 'id' | 'created_at' | 'updated_at'> & {
  id?: string; created_at?: string; updated_at?: string;
};
export type RentalReservationUpdate = Partial<RentalReservationInsert>;

// =============================================================================
// ★ M3: ORDER & PAYMENT MODULE
// =============================================================================

export interface Order {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  order_number: string;                // UNIQUE
  total_amount: number;
  discount_amount: number;
  final_amount: number;
  payment_status: PaymentStatusEnum;
  order_status: 'pending' | 'processing' | 'completed' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type OrderInsert = Omit<Order, 'id' | 'created_at' | 'updated_at'> & {
  id?: string; created_at?: string; updated_at?: string;
};
export type OrderUpdate = Partial<OrderInsert>;

// ───────────────────────────────────────────────────────────
// Junction table: 1NF normalization (order ↔ reservation = N:N)
export interface OrderReservation {
  id: string;                          // UUID PK
  order_id: string;                    // FK orders.id
  reservation_id: string;              // FK rental_reservations.id
  created_at: string;
}

// ───────────────────────────────────────────────────────────
export interface PaymentTransaction {
  id: string;                          // UUID PK
  order_id: string;                    // FK orders.id
  payment_key: string;
  idempotency_key: string;             // UNIQUE — TossPayments v2 중복방지
  amount: number;
  status: PaymentStatusEnum;
  payment_method: 'card' | 'bank_transfer' | 'virtual_account';
  is_deposit: boolean;                 // 선수금(보증금) 여부
  deposit_hold_id: string | null;      // FK deposit_holds.id
  provider_response: Json | null;      // JSONB
  created_at: string;
  updated_at: string;
}

export type PaymentTransactionInsert = Omit<PaymentTransaction, 'id' | 'created_at' | 'updated_at'> & {
  id?: string; created_at?: string; updated_at?: string;
};
export type PaymentTransactionUpdate = Partial<PaymentTransactionInsert>;

// =============================================================================
// ★ M4: MEMBERSHIP & SUBSCRIPTION MODULE
// =============================================================================

export interface UserProfile {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id UNIQUE
  email: string;                       // VARCHAR(255)
  phone: string | null;                // VARCHAR(20)
  name: string | null;                 // VARCHAR(100)
  address: Json | null;                // JSONB
  credit_score: number;               // SMALLINT 0–100
  membership_grade: MembershipGradeEnum;
  grade: MembershipGradeEnum;          // GENERATED ALWAYS AS (membership_grade) STORED
  is_student: boolean;
  student_verified_at: string | null;
  student_doc_url: string | null;
  is_foreign: boolean;
  auth_level: number;                  // SMALLINT 0–3 (외국인 인증단계)
  rental_count: number;
  late_return_count: number;
  damage_count: number;
  points: number;                      // CHECK >= 0
  blacklisted: boolean;
  blacklist_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type UserProfileInsert = Omit<UserProfile, 'id' | 'grade' | 'created_at' | 'updated_at'> & {
  id?: string; created_at?: string; updated_at?: string;
};
export type UserProfileUpdate = Partial<Omit<UserProfileInsert, 'user_id'>>;

// ───────────────────────────────────────────────────────────
export interface Subscription {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  tier: 'easy' | 'pop' | 'crazy';     // EASY 9,900 / POP 19,900 / CRAZY 29,900
  status: SubscriptionStatusEnum;
  price_per_month: number;
  billing_cycle_start: string;         // date
  billing_cycle_end: string;           // date
  auto_renew: boolean;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ───────────────────────────────────────────────────────────
export interface Coupon {
  id: string;                          // UUID PK
  code: string;                        // UNIQUE
  type: CouponTypeEnum;
  discount_type: 'fixed' | 'percentage';
  discount_value: number;
  max_discount_amount: number | null;
  min_purchase_amount: number;
  usage_limit: number;
  usage_count: number;
  is_active: boolean;
  valid_from: string;                  // timestamptz
  valid_until: string;                 // timestamptz
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ───────────────────────────────────────────────────────────
export interface UserCoupon {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  coupon_id: string;                   // FK coupons.id
  used_at: string | null;
  used_count: number;
  created_at: string;
}

// ───────────────────────────────────────────────────────────
export interface DepositHold {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  amount: number;
  reason: string;
  payment_transaction_id: string | null;
  is_released: boolean;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

// ───────────────────────────────────────────────────────────
export interface CreditScoreAudit {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  old_score: number;
  new_score: number;
  reason: string;
  metadata: Json | null;              // JSONB
  created_at: string;
}

// =============================================================================
// ★ M5: SHIPMENT & INSPECTION MODULE
// =============================================================================

export interface Shipment {
  id: string;                          // UUID PK
  reservation_id: string;             // FK rental_reservations.id
  shipment_type: 'pickup' | 'return';
  method: ShipmentMethodEnum;
  status: ShipmentStatusEnum;
  tracking_number: string | null;
  scheduled_date: string;             // date
  actual_date: string | null;
  carrier: string | null;
  carrier_contact: string | null;
  delivery_address: Json | null;      // JSONB
  special_instructions: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ───────────────────────────────────────────────────────────
export interface AssetInspection {
  id: string;                          // UUID PK
  asset_id: string;                    // FK assets.id
  reservation_id: string;              // FK rental_reservations.id
  inspection_type: InspectionTypeEnum;
  inspector_id: string | null;         // FK auth.users.id
  image_urls: string[];                // text[]
  damage_detected: boolean;
  damage_confidence_score: number;     // 0.0–1.0 (Vision Agent threshold: 0.85)
  damage_description: string | null;
  ai_analysis: Json | null;           // JSONB (Claude Vision 분석 결과)
  status: 'pending' | 'completed' | 'disputed';
  created_at: string;
  updated_at: string;
}

// ───────────────────────────────────────────────────────────
export interface Contract {
  id: string;                          // UUID PK
  order_id: string;                    // FK orders.id
  user_id: string;                     // FK auth.users.id
  contract_type: 'rental' | 'subscription';
  status: ContractStatusEnum;
  document_url: string;
  signed_at: string | null;
  terms_accepted_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// =============================================================================
// ★ SUPPORT TABLES
// =============================================================================

export interface NotificationToken {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  token: string;
  platform: 'ios' | 'android' | 'web';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  type: string;                        // 'order_confirmed' | 'shipment_update' | ...
  title: string;
  body: string;
  metadata: Json | null;
  sent_at: string;
  created_at: string;
}

export interface CsPost {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id
  title: string;
  content: string;
  category: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  attachments: string[] | null;        // text[] (URLs)
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CsInquiry {
  id: string;                          // UUID PK
  cs_post_id: string;                  // FK cs_posts.id
  responder_id: string;                // FK auth.users.id (admin)
  response: string;
  is_resolution: boolean;
  created_at: string;
  updated_at: string;
}

export interface PublicHoliday {
  id: string;                          // UUID PK
  date: string;                        // date UNIQUE per country
  name: string;
  country: string;                     // 'KR', 'US', etc.
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LateFee {
  id: string;                          // UUID PK
  reservation_id: string;              // FK rental_reservations.id
  hours_late: number;
  fee_amount: number;
  is_paid: boolean;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ForeignUser {
  id: string;                          // UUID PK
  user_id: string;                     // FK auth.users.id UNIQUE
  country: string;
  passport_number: string;
  visa_type: string;
  auth_level: number;                  // 0–3
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// ★ RPC FUNCTION TYPES (14 functions)
// =============================================================================

export interface AtomicReserveAssetArgs {
  p_product_id: string;   // UUID
  p_start_date: string;   // date
  p_end_date: string;     // date
  p_user_id: string;      // UUID
}

export interface AtomicReserveAssetResult {
  success: boolean;
  reservation_id: string | null;
  asset_id: string | null;
  error_message: string | null;
}

export interface BatchAtomicReserveArgs {
  p_product_assets: Json; // [{product_id, start_date, end_date}]
  p_user_id: string;
}

export interface BatchAtomicReserveResult {
  success: boolean;
  reservation_id: string | null;
  asset_id: string | null;
  product_id: string | null;
  error_message: string | null;
}

export interface CalculateCartTotalArgs {
  p_reservation_ids: string[]; // UUID[]
  p_coupon_code?: string;
  p_user_id: string;
}

export interface CalculateCartTotalResult {
  subtotal: number;
  option_fees: number;
  shipping_cost: number;
  discount_amount: number;
  coupon_discount: number;
  tax_amount: number;
  final_total: number;
  deposit_required: number;
  deposit_percentage: number;
}

export interface ProcessPaymentAndCreateOrderArgs {
  p_reservation_ids: string[];
  p_amount: number;
  p_payment_key: string;
  p_payment_method: string;
  p_idempotency_key: string;
  p_coupon_code?: string;
}

export interface ProcessPaymentAndCreateOrderResult {
  success: boolean;
  order_id: string | null;
  payment_transaction_id: string | null;
  error_message: string | null;
}

// =============================================================================
// ★ SUPABASE DATABASE TYPE (for createClient<Database>())
// =============================================================================

export type Database = {
  public: {
    Tables: {
      products: { Row: Product; Insert: ProductInsert; Update: ProductUpdate };
      assets: { Row: Asset; Insert: AssetInsert; Update: AssetUpdate };
      price_rules: { Row: PriceRule; Insert: PriceRuleInsert; Update: PriceRuleUpdate };
      product_options: { Row: ProductOption; Insert: ProductOptionInsert; Update: ProductOptionUpdate };
      pickup_points: { Row: PickupPoint; Insert: Omit<PickupPoint, 'id' | 'created_at' | 'updated_at'>; Update: Partial<PickupPoint> };
      cart_items: { Row: CartItem; Insert: CartItemInsert; Update: CartItemUpdate };
      rental_reservations: { Row: RentalReservation; Insert: RentalReservationInsert; Update: RentalReservationUpdate };
      orders: { Row: Order; Insert: OrderInsert; Update: OrderUpdate };
      order_reservations: { Row: OrderReservation; Insert: Omit<OrderReservation, 'id' | 'created_at'>; Update: never };
      payment_transactions: { Row: PaymentTransaction; Insert: PaymentTransactionInsert; Update: PaymentTransactionUpdate };
      user_profiles: { Row: UserProfile; Insert: UserProfileInsert; Update: UserProfileUpdate };
      subscriptions: { Row: Subscription; Insert: Omit<Subscription, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Subscription> };
      coupons: { Row: Coupon; Insert: Omit<Coupon, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Coupon> };
      user_coupons: { Row: UserCoupon; Insert: Omit<UserCoupon, 'id' | 'created_at'>; Update: Partial<UserCoupon> };
      deposit_holds: { Row: DepositHold; Insert: Omit<DepositHold, 'id' | 'created_at' | 'updated_at'>; Update: Partial<DepositHold> };
      credit_score_audit: { Row: CreditScoreAudit; Insert: Omit<CreditScoreAudit, 'id' | 'created_at'>; Update: never };
      shipments: { Row: Shipment; Insert: Omit<Shipment, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Shipment> };
      asset_inspections: { Row: AssetInspection; Insert: Omit<AssetInspection, 'id' | 'created_at' | 'updated_at'>; Update: Partial<AssetInspection> };
      contracts: { Row: Contract; Insert: Omit<Contract, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Contract> };
      notification_tokens: { Row: NotificationToken; Insert: Omit<NotificationToken, 'id' | 'created_at' | 'updated_at'>; Update: Partial<NotificationToken> };
      notification_logs: { Row: NotificationLog; Insert: Omit<NotificationLog, 'id' | 'created_at'>; Update: never };
      cs_posts: { Row: CsPost; Insert: Omit<CsPost, 'id' | 'created_at' | 'updated_at'>; Update: Partial<CsPost> };
      cs_inquiries: { Row: CsInquiry; Insert: Omit<CsInquiry, 'id' | 'created_at' | 'updated_at'>; Update: Partial<CsInquiry> };
      public_holidays: { Row: PublicHoliday; Insert: Omit<PublicHoliday, 'id' | 'created_at' | 'updated_at'>; Update: Partial<PublicHoliday> };
      late_fees: { Row: LateFee; Insert: Omit<LateFee, 'id' | 'created_at' | 'updated_at'>; Update: Partial<LateFee> };
      foreign_users: { Row: ForeignUser; Insert: Omit<ForeignUser, 'id' | 'created_at' | 'updated_at'>; Update: Partial<ForeignUser> };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      atomic_reserve_asset: {
        Args: AtomicReserveAssetArgs;
        Returns: AtomicReserveAssetResult[];
      };
      batch_atomic_reserve: {
        Args: BatchAtomicReserveArgs;
        Returns: BatchAtomicReserveResult[];
      };
      calculate_cart_total: {
        Args: CalculateCartTotalArgs;
        Returns: CalculateCartTotalResult[];
      };
      process_payment_and_create_order: {
        Args: ProcessPaymentAndCreateOrderArgs;
        Returns: ProcessPaymentAndCreateOrderResult[];
      };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      ensure_user_profile: { Args: Record<string, never>; Returns: string };
    };
    Enums: {
      product_category_enum: ProductCategoryEnum;
      asset_status_enum: AssetStatusEnum;
      duration_type_enum: DurationTypeEnum;
      reservation_status_enum: ReservationStatusEnum;
      payment_status_enum: PaymentStatusEnum;
      shipment_method_enum: ShipmentMethodEnum;
      shipment_status_enum: ShipmentStatusEnum;
      membership_grade_enum: MembershipGradeEnum;
      coupon_type_enum: CouponTypeEnum;
      option_type_enum: OptionTypeEnum;
      contract_status_enum: ContractStatusEnum;
      inspection_type_enum: InspectionTypeEnum;
      subscription_status_enum: SubscriptionStatusEnum;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ────────────────────────────────────────────────────────────
// 유틸 헬퍼 타입 — Supabase 표준 패턴
// Tables<'products'> → ProductRow 타입과 동일
// ────────────────────────────────────────────────────────────
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
