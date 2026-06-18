/**
 * cartFixtures.ts — 장바구니 UI 개발용 더미 데이터
 * 목적: /dev/cart 라우트에서 모킹된 더미 상품/예약/가격 정보 제공
 * 
 * 샘플:
 *   상품 4개: Sony FX6 (카메라), DJI RS4 Pro (짐벌), Godox AD600 (조명), Sony 24-70 GM2 (렌즈)
 *   예약: 오늘부터 3일 대여 기본값
 *   크레이지스코어: 72 → 보증금 30%
 *   멤버십: PRO → 10% 할인
 */

import type { Product, Asset, CartItem, RentalReservation } from '$lib/types/database';

// ─────────────────────────────────────────────────────
// 샘플 상품 (4개)
// ─────────────────────────────────────────────────────

export const sampleProducts: Product[] = [
  {
    id: 'prod-001',
    category: 'camera',
    name: 'Sony FX6',
    slug: 'sony-fx6',
    brand: 'Sony',
    description: 'Professional cinema camera with 4K recording',
    image_urls: ['https://res.cloudinary.com/crazyshot/image/upload/w_400,h_300,c_fill,f_auto,q_auto/sony-fx6.jpg'],
    specifications: {
      sensor: 'Full Frame',
      resolution: '4K UHD',
      weight: '680g'
    },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  },
  {
    id: 'prod-002',
    category: 'accessory',
    name: 'DJI RS4 Pro',
    slug: 'dji-rs4-pro',
    brand: 'DJI',
    description: 'Professional gimbal for cinema cameras',
    image_urls: ['https://res.cloudinary.com/crazyshot/image/upload/w_400,h_300,c_fill,f_auto,q_auto/dji-rs4.jpg'],
    specifications: {
      type: 'Gimbal',
      payload: '3kg',
      weight: '1.3kg'
    },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  },
  {
    id: 'prod-003',
    category: 'lighting',
    name: 'Godox AD600',
    slug: 'godox-ad600',
    brand: 'Godox',
    description: 'Portable studio flash with TTL',
    image_urls: ['https://res.cloudinary.com/crazyshot/image/upload/w_400,h_300,c_fill,f_auto,q_auto/godox-ad600.jpg'],
    specifications: {
      power: '600W',
      type: 'Strobe',
      weight: '0.8kg'
    },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  },
  {
    id: 'prod-004',
    category: 'lens',
    name: 'Sony 24-70mm GM2',
    slug: 'sony-24-70-gm2',
    brand: 'Sony',
    description: 'Premium zoom lens for full frame cameras',
    image_urls: ['https://res.cloudinary.com/crazyshot/image/upload/w_400,h_300,c_fill,f_auto,q_auto/sony-24-70.jpg'],
    specifications: {
      mount: 'E-Mount',
      focal_length: '24-70mm',
      weight: '680g'
    },
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  }
];

// ─────────────────────────────────────────────────────
// 샘플 자산 (각 상품당 1개)
// ─────────────────────────────────────────────────────

export const sampleAssets: Asset[] = [
  {
    id: 'asset-001',
    product_id: 'prod-001',
    asset_code: 'SONY-FX6-001',
    serial_number: 'FX6-2024-0001',
    status: 'available',
    condition_notes: 'Excellent condition',
    purchase_date: '2024-01-01',
    last_maintenance_date: '2026-06-01',
    next_maintenance_date: '2026-07-01',
    maintenance_interval_days: 30,
    is_insured: true,
    insurance_provider: 'AIG',
    insurance_policy_number: 'POL-SONY-001',
    warehouse_location: 'Seoul-A1-01',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  },
  {
    id: 'asset-002',
    product_id: 'prod-002',
    asset_code: 'DJI-RS4-001',
    serial_number: 'RS4-2024-0001',
    status: 'available',
    condition_notes: 'Like new',
    purchase_date: '2024-02-15',
    last_maintenance_date: '2026-06-10',
    next_maintenance_date: '2026-07-10',
    maintenance_interval_days: 30,
    is_insured: true,
    insurance_provider: 'AIG',
    insurance_policy_number: 'POL-DJI-001',
    warehouse_location: 'Seoul-A1-02',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  },
  {
    id: 'asset-003',
    product_id: 'prod-003',
    asset_code: 'GODOX-AD600-001',
    serial_number: 'AD600-2024-0001',
    status: 'available',
    condition_notes: 'Good condition',
    purchase_date: '2024-03-20',
    last_maintenance_date: '2026-06-05',
    next_maintenance_date: '2026-07-05',
    maintenance_interval_days: 30,
    is_insured: true,
    insurance_provider: 'AIG',
    insurance_policy_number: 'POL-GODOX-001',
    warehouse_location: 'Seoul-A1-03',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  },
  {
    id: 'asset-004',
    product_id: 'prod-004',
    asset_code: 'SONY-24-70-001',
    serial_number: '24-70-2024-0001',
    status: 'available',
    condition_notes: 'Excellent condition',
    purchase_date: '2024-01-15',
    last_maintenance_date: '2026-06-08',
    next_maintenance_date: '2026-07-08',
    maintenance_interval_days: 30,
    is_insured: true,
    insurance_provider: 'AIG',
    insurance_policy_number: 'POL-SONY-LENS-001',
    warehouse_location: 'Seoul-A1-04',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  }
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
    asset_id: 'asset-001',
    order_id: null,
    status: 'hold',
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    actual_pickup_date: null,
    actual_return_date: null,
    pickup_method: 'quick',
    return_method: 'quick',
    pickup_point_id: null,
    return_point_id: null,
    hold_expiration_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    damage_reported: false,
    damage_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  },
  {
    id: 'res-002',
    user_id: 'user-demo',
    asset_id: 'asset-002',
    order_id: null,
    status: 'hold',
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    actual_pickup_date: null,
    actual_return_date: null,
    pickup_method: 'crazydelivery',
    return_method: 'crazydelivery',
    pickup_point_id: null,
    return_point_id: null,
    hold_expiration_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    damage_reported: false,
    damage_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  }
];

// ─────────────────────────────────────────────────────
// 샘플 장바구니 아이템 (Zone 정보 포함)
// ─────────────────────────────────────────────────────

export const sampleCartItems: CartItem[] = [
  {
    id: 'cart-001',
    user_id: 'user-demo',
    product_id: 'prod-001',
    asset_id: 'asset-001',
    duration_type: '24h',
    quantity: 1,
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    selected_options: [],
    zone: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'cart-002',
    user_id: 'user-demo',
    product_id: 'prod-002',
    asset_id: 'asset-002',
    duration_type: '24h',
    quantity: 1,
    rental_start_date: formatDate(tomorrow),
    rental_end_date: formatDate(endDate),
    selected_options: [],
    zone: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
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
  membership_grade: 'pro' as const,
  crazy_score: 72,
  is_verified: true,
  terms_agreed: true,
  created_at: new Date().toISOString()
};

// ─────────────────────────────────────────────────────
// 렌탈료 정보 (기본 가격 설정)
// ─────────────────────────────────────────────────────

export const priceConfig = {
  'prod-001': {
    daily_rate: 150000,      // Sony FX6: 150k/day
    weekly_rate: 900000,     // 900k/week
    monthly_rate: 3000000    // 3M/month
  },
  'prod-002': {
    daily_rate: 80000,       // DJI RS4 Pro: 80k/day
    weekly_rate: 480000,     // 480k/week
    monthly_rate: 1600000    // 1.6M/month
  },
  'prod-003': {
    daily_rate: 50000,       // Godox AD600: 50k/day
    weekly_rate: 300000,     // 300k/week
    monthly_rate: 1000000    // 1M/month
  },
  'prod-004': {
    daily_rate: 60000,       // Sony 24-70: 60k/day
    weekly_rate: 360000,     // 360k/week
    monthly_rate: 1200000    // 1.2M/month
  }
};

// ─────────────────────────────────────────────────────
// 하위 옵션 상품 목록 (Figma: Sub1 └ 화살표 아이템)
// parent_cart_id → 어떤 장바구니 항목의 하위 옵션인지
// ─────────────────────────────────────────────────────

export interface SubCartItem {
  id: string;
  parent_cart_id: string;
  product_id: string;
  name: string;
  slug: string;
  daily_rate: number;
  quantity: number;
}

export const sampleSubItems: SubCartItem[] = [
  {
    id: 'sub-001',
    parent_cart_id: 'cart-001',
    product_id: 'prod-003',
    name: 'Godox AD600',
    slug: 'godox-ad600',
    daily_rate: 50000,
    quantity: 1
  },
  {
    id: 'sub-002',
    parent_cart_id: 'cart-001',
    product_id: 'prod-004',
    name: 'Sony 24-70mm GM2',
    slug: 'sony-24-70-gm2',
    daily_rate: 60000,
    quantity: 1
  }
];

// ─────────────────────────────────────────────────────
// 배송 마감 정보
// ─────────────────────────────────────────────────────

export const shippingDeadlines = {
  'crazydelivery': { deadline: '19:00', free: true },
  'quick': { deadline: '17:00', free: false },
  'locker': { deadline: '18:00', free: false },
  'visit': { deadline: '19:00', free: false },
  'airport': { deadline: '15:00', free: false }
};
