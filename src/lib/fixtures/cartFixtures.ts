/**
 * cartFixtures.ts — 장바구니 UI 개발용 더미 데이터
 * 목적: /checkout 라우트에서 isDevMode=true 시 폴백 데이터 제공
 *
 * Stage DB (ezyvffjvuwmtuhpxdjrw) 실제 상품 정보 반영:
 *   Card 1 Main : Sony FX6-12           (98f44cf6-...) 24h 23,000 / 12h 53,000
 *   Card 2 Main : SONY PXW-Z90          (467c8f9b-...) 24h 30,000 / 12h 25,000
 *   Sub-item 1  : Idol SET07 Canon R6   (924919dc-...) 24h 75,000 / 12h 55,000
 *   Sub-item 2  : Canon RF 24-70mm F2.8L (955238da-...) 24h 25,000 / 12h 20,000
 */

import type { Product, Asset, CartItem, RentalReservation } from '$lib/types/database';

// ─────────────────────────────────────────────────────
// 상수 — Stage DB 실제 product UUID
// ─────────────────────────────────────────────────────

const P1_ID = '98f44cf6-6056-4053-81dc-b439d5f886ac';   // Sony FX6-12
const P2_ID = '467c8f9b-ca0e-4143-8c27-d04c993a8baa';   // SONY PXW-Z90
const P3_ID = '924919dc-369f-4ce1-a529-951afe4167ef';   // Idol SET07
const P4_ID = '955238da-5440-47b1-906d-4865232f3a6c';   // Canon RF 24-70mm

// Stage Supabase Storage base
const STORAGE = 'https://ezyvffjvuwmtuhpxdjrw.supabase.co/storage/v1/object/public/product-images';

// ─────────────────────────────────────────────────────
// 샘플 상품 (Stage DB 실 데이터 기반 4개)
// ─────────────────────────────────────────────────────

export const sampleProducts: Product[] = [
  {
    id: P1_ID,
    category: 'lighting',
    name: 'Sony FX6-12',
    slug: 'sony-fx6-12',
    brand: 'Sony',
    description: 'Professional cinema camera with full-frame sensor',
    image_urls: [
      `${STORAGE}/${P1_ID}/large_d50aee6f-15ec-47db-a162-574277d6d37b.webp`,
      `${STORAGE}/${P1_ID}/large_ccfcbd0d-c7b0-4666-88b4-d7ae4e64d52d.webp`,
    ],
    specifications: { sensor: 'Full Frame', resolution: '4K UHD' },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
  {
    id: P2_ID,
    category: 'camera',
    name: 'SONY PXW-Z90',
    slug: 'cam-zo-2607',
    brand: 'SONY',
    description: 'Professional 4K HDR camcorder',
    image_urls: [
      `${STORAGE}/${P2_ID}/large_c5d6b57c-7383-4f7a-b1dc-f23eea280033.webp`,
      `${STORAGE}/${P2_ID}/large_65c5f462-20d7-4ce3-b0c8-999c7f181a32.webp`,
    ],
    specifications: { type: 'Camcorder', resolution: '4K HDR' },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
  {
    id: P3_ID,
    category: 'camera',
    name: 'Idol SET07 Canon EOS R6 Mark II + Canon 100-500mm',
    slug: 'pkg-idol-set07-canon-eos-r6-mark-ii-canon-100-500mm-f45-71l-is-usm-2607',
    brand: 'CANON',
    description: 'Camera package set for idol photography',
    image_urls: [
      `${STORAGE}/${P3_ID}/large_32b3c571-8218-4e47-88da-7fd6e48834b9.webp`,
    ],
    specifications: { type: 'Package' },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
  {
    id: P4_ID,
    category: 'lens',
    name: 'Canon RF 24-70mm F2.8L',
    slug: 'lns-canon-rf-24-70mm-f28l-2607',
    brand: 'CANON',
    description: 'Professional zoom lens for Canon RF mount',
    image_urls: [
      `${STORAGE}/${P4_ID}/large_c7707730-27bf-4cce-8f3e-8dbbb3a6c107.webp`,
      `${STORAGE}/${P4_ID}/large_7e1ff9d7-d839-4f45-8b4d-171afbde8d1f.webp`,
    ],
    specifications: { mount: 'RF', focal_length: '24-70mm', aperture: 'f/2.8' },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
];

// ─────────────────────────────────────────────────────
// 샘플 자산 (Stage DB asset_id=2 → Sony FX6-12 자산 존재)
// ─────────────────────────────────────────────────────

export const sampleAssets: Asset[] = [
  {
    id: 'asset-fx6',
    product_id: P1_ID,
    asset_code: 'SONY-FX6-12-001',
    serial_number: 'FX6-STAGE-001',
    status: 'available',
    condition_notes: 'Stage DB asset',
    purchase_date: '2024-01-01',
    last_maintenance_date: '2026-06-01',
    next_maintenance_date: '2026-07-01',
    maintenance_interval_days: 30,
    is_insured: true,
    insurance_provider: 'AIG',
    insurance_policy_number: 'POL-FX6-001',
    warehouse_location: 'Seoul-A1-01',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
  {
    id: 'asset-z90',
    product_id: P2_ID,
    asset_code: 'SONY-Z90-001',
    serial_number: 'Z90-STAGE-001',
    status: 'available',
    condition_notes: 'Stage DB mock asset',
    purchase_date: '2024-02-15',
    last_maintenance_date: '2026-06-10',
    next_maintenance_date: '2026-07-10',
    maintenance_interval_days: 30,
    is_insured: true,
    insurance_provider: 'AIG',
    insurance_policy_number: 'POL-Z90-001',
    warehouse_location: 'Seoul-A1-02',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
];

// ─────────────────────────────────────────────────────
// 샘플 예약 (2개 — 오늘부터 3일)
// ─────────────────────────────────────────────────────

const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const endDate = new Date(today);
endDate.setDate(endDate.getDate() + 3);

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const sampleReservations: RentalReservation[] = [
  {
    id: 'res-001',
    user_id: 'user-demo',
    asset_id: 'asset-fx6',
    order_id: null,
    status: 'hold',
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    actual_pickup_date: null,
    actual_return_date: null,
    pickup_method: 'quick',
    return_method: 'quick',
    pickup_time: null,
    return_time: null,
    pickup_point_id: null,
    return_point_id: null,
    hold_expiration_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    damage_reported: false,
    damage_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
  {
    id: 'res-002',
    user_id: 'user-demo',
    asset_id: 'asset-z90',
    order_id: null,
    status: 'hold',
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    actual_pickup_date: null,
    actual_return_date: null,
    pickup_method: 'crazydelivery',
    return_method: 'crazydelivery',
    pickup_time: null,
    return_time: null,
    pickup_point_id: null,
    return_point_id: null,
    hold_expiration_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    damage_reported: false,
    damage_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  },
];

// ─────────────────────────────────────────────────────
// 샘플 장바구니 아이템 (Stage DB product_id 기준)
// ─────────────────────────────────────────────────────

export const sampleCartItems: CartItem[] = [
  {
    id: 'cart-001',
    user_id: 'user-demo',
    product_id: P1_ID,
    asset_id: 'asset-fx6',
    duration_type: '24h',
    quantity: 1,
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    selected_options: [],
    zone: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'cart-002',
    user_id: 'user-demo',
    product_id: P2_ID,
    asset_id: 'asset-z90',
    duration_type: '24h',
    quantity: 1,
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    selected_options: [],
    zone: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// ─────────────────────────────────────────────────────
// 사용자 프로필 시뮬레이션
// ─────────────────────────────────────────────────────

export const mockUserProfile = {
  user_id: 'user-demo',
  username: 'demouser',
  display_name: '데모 사용자',
  phone: '+82-10-1234-5678',
  address: 'Seoul, South Korea',
  postal_code: '06000',
  membership_grade: 'NONE' as const,
  crazy_score: 72,
  is_verified: true,
  terms_agreed: true,
  created_at: new Date().toISOString(),
};

// ─────────────────────────────────────────────────────
// 렌탈료 정보 — Stage DB price_rules 기준 (24h / 12h)
// ─────────────────────────────────────────────────────

export const priceConfig: Record<string, { daily_rate: number; halfday_rate: number }> = {
  [P1_ID]: { daily_rate: 23000, halfday_rate: 53000 },   // Sony FX6-12
  [P2_ID]: { daily_rate: 30000, halfday_rate: 25000 },   // SONY PXW-Z90
  [P3_ID]: { daily_rate: 75000, halfday_rate: 55000 },   // Idol SET07
  [P4_ID]: { daily_rate: 25000, halfday_rate: 20000 },   // Canon RF 24-70mm
};

// ─────────────────────────────────────────────────────
// 하위 옵션 상품 목록 (Card 1 소속 sub-items)
// ─────────────────────────────────────────────────────

export interface SubCartItem {
  id: string;
  parent_cart_id: string;
  product_id: string;
  name: string;
  slug: string;
  imageUrl: string;
  daily_rate: number;
  halfday_rate: number;
  quantity: number;
}

export const sampleSubItems: SubCartItem[] = [
  {
    id: 'sub-001',
    parent_cart_id: 'cart-001',
    product_id: P3_ID,
    name: 'Idol SET07 Canon EOS R6 Mark II + 100-500mm',
    slug: 'pkg-idol-set07',
    imageUrl: `${STORAGE}/${P3_ID}/large_32b3c571-8218-4e47-88da-7fd6e48834b9.webp`,
    daily_rate: 75000,
    halfday_rate: 55000,
    quantity: 1,
  },
  {
    id: 'sub-002',
    parent_cart_id: 'cart-001',
    product_id: P4_ID,
    name: 'Canon RF 24-70mm F2.8L',
    slug: 'lns-canon-rf-24-70mm-f28l-2607',
    imageUrl: `${STORAGE}/${P4_ID}/large_c7707730-27bf-4cce-8f3e-8dbbb3a6c107.webp`,
    daily_rate: 25000,
    halfday_rate: 20000,
    quantity: 1,
  },
];

// ─────────────────────────────────────────────────────
// 배송 마감 정보
// ─────────────────────────────────────────────────────

export const shippingDeadlines = {
  crazydelivery: { deadline: '15:00', free: true },
  quick:         { deadline: '17:00', free: false },
  locker:        { deadline: '18:00', free: false },
  visit:         { deadline: '19:00', free: false },
  epost:         { deadline: '15:00', free: false },
};
