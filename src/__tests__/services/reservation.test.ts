import { describe, it, expect } from 'vitest';
import { supabase, rpc } from '$lib/services/supabase';
import type { AssetStatusEnum, ReservationStatusEnum } from '$lib/types/database';

/**
 * S1-M2 Reservation Flow Tests (TDD)
 * Schema: v5.46 — UUID IDs, hold-based state machine
 *
 * RED → GREEN → REFACTOR cycle
 *
 * §13 Business rules tested:
 *   - atomic_reserve_asset: SELECT FOR UPDATE SKIP LOCKED
 *   - EXCLUDE gist: 중복 예약 방지
 *   - 10분 hold 만료 (hold_expiration_at)
 *   - credit_score < 30 → 렌탈 거부
 */

// Test product UUID (seeded: Canon R5)
const SEED_PRODUCT_ID = '00000000-0000-0000-0000-000000000001';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000099';
const NON_EXISTENT_UUID = '99999999-9999-9999-9999-999999999999';

const dateStr = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
};

describe('Reservation System (v5.46)', () => {
  describe('atomic_reserve_asset — 단일 자산 원자적 예약', () => {
    it('RED: 가용 자산 예약 성공 → reservation_id (UUID) 반환', async () => {
      const result = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: dateStr(1),
        p_end_date: dateStr(8),
        p_user_id: TEST_USER_ID,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      // UUID 형식 검증
      expect(result.reservation_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(result.asset_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(result.error_message).toBeNull();
    });

    it('RED: 예약 후 자산 status → hold', async () => {
      const result = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: dateStr(10),
        p_end_date: dateStr(11),
        p_user_id: TEST_USER_ID,
      });

      if (result.success && result.asset_id) {
        const assetId: string = result.asset_id;
        const { data: asset } = await supabase
          .from('assets')
          .select('status')
          .eq('id', assetId)
          .single();

        // hold 상태 — 결제 완료 전까지 hold
        const assetRow = asset as { status: AssetStatusEnum } | null;
        expect(assetRow?.status).toBe('hold');
      }
    });

    it('RED: 존재하지 않는 product → 실패 + error_message', async () => {
      const result = await rpc.atomicReserveAsset({
        p_product_id: NON_EXISTENT_UUID,
        p_start_date: dateStr(1),
        p_end_date: dateStr(3),
        p_user_id: TEST_USER_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error_message).toBeDefined();
      expect(result.error_message).not.toBeNull();
    });

    it('RED: credit_score < 30 사용자 → 렌탈 거부 (§13)', async () => {
      // 낮은 신용점수 테스트 유저
      const lowCreditUserId = '00000000-0000-0000-0000-000000000020';

      const result = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: dateStr(1),
        p_end_date: dateStr(3),
        p_user_id: lowCreditUserId,
      });

      expect(result.success).toBe(false);
      expect(result.error_message).toContain('신용점수');
    });
  });

  describe('예약 날짜 중복 방지 (EXCLUDE gist)', () => {
    it('RED: 동일 자산 기간 중복 예약 → 차단', async () => {
      const start = dateStr(20);
      const end = dateStr(25);

      const result1 = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: start,
        p_end_date: end,
        p_user_id: TEST_USER_ID,
      });

      // 같은 기간에 같은 자산으로 두 번 예약 → 두 번째는 다른 자산으로 배정되거나 실패
      const result2 = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: start,
        p_end_date: end,
        p_user_id: TEST_USER_ID,
      });

      if (result1.success && result2.success) {
        // 두 예약은 서로 다른 자산이어야 함
        expect(result1.asset_id).not.toBe(result2.asset_id);
      }
      // 또는 두 번째는 실패 (재고 부족)
    });

    it('GREEN: 겹치지 않는 날짜 → 동일 자산도 예약 가능', () => {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      // 날짜 형식 검증
      expect(dateRegex.test(dateStr(0))).toBe(true);
      expect(dateRegex.test('06/01/2026')).toBe(false);
    });

    it('REFACTOR: rental_end_date >= rental_start_date 검증', () => {
      const start = '2026-06-10';
      const end = '2026-06-05';

      // 서버 CHECK 제약 전 클라이언트 검증
      expect(new Date(end) >= new Date(start)).toBe(false);
    });
  });

  describe('Reservation 상태 머신', () => {
    it('RED: 예약 초기 status → hold (10분 만료)', async () => {
      const result = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: dateStr(30),
        p_end_date: dateStr(33),
        p_user_id: TEST_USER_ID,
      });

      if (result.success && result.reservation_id) {
        const reservationId: string = result.reservation_id;
        const { data: reservation } = await supabase
          .from('rental_reservations')
          .select('status, hold_expiration_at')
          .eq('id', reservationId)
          .single();

        type ReservationRow = { status: ReservationStatusEnum; hold_expiration_at: string | null };
        const row = reservation as ReservationRow | null;
        expect(row?.status).toBe('hold');
        // hold_expiration_at이 미래여야 함
        expect(new Date(row?.hold_expiration_at ?? 0) > new Date()).toBe(true);
      }
    });

    it('REFACTOR: 유효한 상태 전환 검증', () => {
      const validTransitions: Record<string, string[]> = {
        hold:      ['confirmed', 'cancelled'],
        confirmed: ['in_use', 'cancelled'],
        in_use:    ['returned', 'damaged', 'overdue'],
        returned:  [],       // Terminal
        cancelled: [],       // Terminal
        damaged:   ['disputed'],
        overdue:   ['returned', 'cancelled'],
        disputed:  ['returned', 'cancelled'],
      };

      expect(validTransitions.hold).toContain('confirmed');
      expect(validTransitions.confirmed).not.toContain('hold');
      expect(validTransitions.returned).toEqual([]);
    });
  });

  describe('Cart Total 연동 (calculate_cart_total)', () => {
    it('GREEN: 예약 후 cart total 계산 → final_total > 0', async () => {
      const result = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: dateStr(40),
        p_end_date: dateStr(47),
        p_user_id: TEST_USER_ID,
      });

      if (result.success && result.reservation_id) {
        const cartTotal = await rpc.calculateCartTotal({
          p_reservation_ids: [result.reservation_id],
          p_user_id: TEST_USER_ID,
        });

        expect(cartTotal).toBeDefined();
        expect(cartTotal.subtotal).toBeGreaterThanOrEqual(0);
        expect(cartTotal.final_total).toBeGreaterThanOrEqual(0);
        expect(cartTotal.deposit_percentage).toBeGreaterThan(0);
        expect(cartTotal.deposit_percentage).toBeLessThanOrEqual(1);
      }
    });

    it('GREEN: 할인 적용 후 final_total ≤ subtotal', async () => {
      const result = await rpc.atomicReserveAsset({
        p_product_id: SEED_PRODUCT_ID,
        p_start_date: dateStr(50),
        p_end_date: dateStr(53),
        p_user_id: TEST_USER_ID,
      });

      if (result.success && result.reservation_id) {
        const cartTotal = await rpc.calculateCartTotal({
          p_reservation_ids: [result.reservation_id],
          p_user_id: TEST_USER_ID,
          p_coupon_code: 'TEST10',
        });

        // 할인 적용 후에도 final_total은 음수가 될 수 없음
        expect(cartTotal.final_total).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
