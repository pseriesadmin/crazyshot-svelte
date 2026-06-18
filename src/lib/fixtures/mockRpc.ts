/**
 * mockRpc.ts — 개발 환경용 RPC 응답 모킹
 * 목적: /dev/cart 라우트에서 실제 Supabase 호출 대신 모킹된 응답 반환
 * 
 * 모킹 함수:
 *   - calculateCartTotal() — 장바구니 총액 계산
 *   - checkAssetAvailability() — 자산 가용성 확인
 *   - checkDeliveryDeadline() — 배송 마감 확인
 */

import type { CartItem } from '$lib/types/database';
import { priceConfig } from './cartFixtures';

// ─────────────────────────────────────────────────────
// 가격 계산 로직
// ─────────────────────────────────────────────────────

interface PriceBreakdown {
  basePrice: number;
  membershipDiscount: number;
  couponDiscount: number;
  pointsUsed: number;
  depositAmount: number;
  shippingCost: number;
  vatAmount: number;
  totalPrice: number;
  finalPrice: number;
}

/**
 * 대여 기간 분류 (M2 rental.md 기준)
 * 일간: 1~7일, 주간: 8~30일, 월간: 31일+
 */
function calculateRentalDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function getPriceByDuration(
  productId: string,
  startDate: string,
  endDate: string
): number {
  const days = calculateRentalDays(startDate, endDate);
  const config = priceConfig[productId as keyof typeof priceConfig];
  if (!config) return 0;

  if (days <= 7) {
    return config.daily_rate * days;
  } else if (days <= 30) {
    const weeks = Math.floor(days / 7);
    const remainDays = days % 7;
    return config.weekly_rate * weeks + config.daily_rate * remainDays;
  } else {
    const months = Math.floor(days / 30);
    const remainDays = days % 30;
    const remainWeeks = Math.floor(remainDays / 7);
    const finalDays = remainDays % 7;
    return (
      config.monthly_rate * months +
      config.weekly_rate * remainWeeks +
      config.daily_rate * finalDays
    );
  }
}

/**
 * 크레이지스코어에 따른 보증금 비율 (M3 payment.md 기준)
 * score >= 85 → 0% / 70~84 → 30% / 50~69 → 50% / < 50 → 100%
 */
function getDepositPercentage(crazyScore: number): number {
  if (crazyScore >= 85) return 0;
  if (crazyScore >= 70) return 0.3;
  if (crazyScore >= 50) return 0.5;
  return 1.0;
}

/**
 * 멤버십 할인율 (M2 rental.md 기준)
 * CRAZY: 15% / PRO: 10% / BASIC: 0%
 */
function getMembershipDiscount(grade: string | null): number {
  if (!grade) return 0;
  if (grade === 'crazy') return 0.15;
  if (grade === 'pro') return 0.1;
  return 0;
}

// ─────────────────────────────────────────────────────
// 모킹 함수: 장바구니 총액 계산
// ─────────────────────────────────────────────────────

export async function mockCalculateCartTotal(
  cartItems: CartItem[],
  membershipGrade: string | null,
  crazyScore: number,
  couponCode?: string,
  pointsToUse: number = 0
): Promise<PriceBreakdown> {
  // 기본 렌탈료 계산
  let basePrice = 0;
  for (const item of cartItems) {
    const itemPrice = getPriceByDuration(
      item.product_id,
      item.rental_start_date,
      item.rental_end_date
    );
    basePrice += itemPrice * item.quantity;
  }

  // 멤버십 할인
  const membershipDiscount = Math.floor(basePrice * getMembershipDiscount(membershipGrade));

  // 쿠폰 할인 (모킹: 고정 10% 또는 0)
  const couponDiscount = couponCode ? Math.floor(basePrice * 0.1) : 0;

  // 포인트 차감 (사용한 포인트)
  const pointsUsed = Math.min(pointsToUse, basePrice - membershipDiscount - couponDiscount);

  // VAT 역산 (부가세 10% 포함)
  const subtotal = basePrice - membershipDiscount - couponDiscount - pointsUsed;
  const vatAmount = Math.floor(subtotal / 1.1);

  // 배송비 (CRAZY 등급만 무료, 나머지 5k)
  const shippingCost = membershipGrade === 'crazy' ? 0 : 5000;

  // 보증금 (크레이지스코어 기반)
  const depositPercentage = getDepositPercentage(crazyScore);
  const depositAmount = Math.floor(basePrice * depositPercentage);

  // 최종 금액 = 기본료 - 할인 - 포인트 + 배송비 + 보증금
  const totalPrice = basePrice - membershipDiscount - couponDiscount - pointsUsed + shippingCost + depositAmount;
  const finalPrice = totalPrice;

  return {
    basePrice,
    membershipDiscount,
    couponDiscount,
    pointsUsed,
    depositAmount,
    shippingCost,
    vatAmount,
    totalPrice,
    finalPrice
  };
}

// ─────────────────────────────────────────────────────
// 모킹 함수: 자산 가용성 확인
// ─────────────────────────────────────────────────────

export async function mockCheckAssetAvailability(
  _productId: string,
  _startDate: string,
  _endDate: string
): Promise<{ available: boolean; availableCount: number }> {
  // 모킹: 항상 가용성 있음 (더미 데이터이므로)
  return {
    available: true,
    availableCount: 1
  };
}

// ─────────────────────────────────────────────────────
// 모킹 함수: 배송 마감 확인
// ─────────────────────────────────────────────────────

export interface DeliveryDeadlineResult {
  canDeliver: boolean;
  deadline: string;
  hoursRemaining: number;
  isHoliday: boolean;
}

const DELIVERY_DEADLINES = new Map<string, string>([
  ['crazydelivery', '19:00'],
  ['quick', '17:00'],
  ['locker', '18:00'],
  ['visit', '19:00'],
  ['airport', '15:00']
]);

export async function mockCheckDeliveryDeadline(
  method: string,
  _startDate: string
): Promise<DeliveryDeadlineResult> {
  const deadline = DELIVERY_DEADLINES.get(method) ?? '17:00';
  const now = new Date();
  const [hours, minutes] = deadline.split(':').map(Number);
  const deadlineToday = new Date();
  deadlineToday.setHours(hours, minutes, 0, 0);

  const hoursRemaining = Math.max(
    0,
    Math.floor((deadlineToday.getTime() - now.getTime()) / (1000 * 60 * 60))
  );

  const canDeliver = now < deadlineToday;

  return {
    canDeliver,
    deadline,
    hoursRemaining,
    isHoliday: false
  };
}

// ─────────────────────────────────────────────────────
// 모킹 함수: 결제 시뮬레이션
// ─────────────────────────────────────────────────────

export interface PaymentSimulationResult {
  success: boolean;
  orderId?: string;
  message: string;
  transactionId?: string;
}

export async function mockProcessPayment(
  cartItems: CartItem[],
  totalAmount: number,
  paymentMethod: string
): Promise<PaymentSimulationResult> {
  // 모킹: 항상 성공 (개발 테스트용)
  const orderId = `ORD-${Date.now()}`;
  const transactionId = `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  return {
    success: true,
    orderId,
    message: `Payment successful via ${paymentMethod}`,
    transactionId
  };
}
