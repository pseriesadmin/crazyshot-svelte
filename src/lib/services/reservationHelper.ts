/**
 * Reservation Helper Functions (S1-M2)
 * Utilities for date validation, conflict detection, and state management
 */

/**
 * Validates that a date string is in ISO format (YYYY-MM-DD)
 */
export function isValidDateFormat(dateString: string): boolean {
	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateRegex.test(dateString)) {
		return false;
	}

	// Additional validation: ensure it's a valid date
	const date = new Date(dateString + 'T00:00:00Z');
	if (isNaN(date.getTime())) {
		return false;
	}

	// Verify the parsed date matches the input string (catches invalid dates like 2026-02-30)
	const [year, month, day] = dateString.split('-').map(Number);
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

/**
 * Validates that end date is after start date
 */
export function isValidDateRange(startDate: string, endDate: string): boolean {
	if (!isValidDateFormat(startDate) || !isValidDateFormat(endDate)) {
		return false;
	}

	return new Date(endDate) > new Date(startDate);
}

/**
 * Checks if two date ranges overlap
 * Returns true if ranges overlap, false otherwise
 */
export function doDateRangesOverlap(
	start1: string,
	end1: string,
	start2: string,
	end2: string
): boolean {
	const s1 = new Date(start1);
	const e1 = new Date(end1);
	const s2 = new Date(start2);
	const e2 = new Date(end2);

	// Ranges overlap if: start1 < end2 AND start2 < end1
	return s1 < e2 && s2 < e1;
}

/**
 * Calculates number of days between two dates
 */
export function calculateDays(startDate: string, endDate: string): number {
	const s = new Date(startDate);
	const e = new Date(endDate);
	const diffTime = Math.abs(e.getTime() - s.getTime());
	const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
	return diffDays;
}

/**
 * Determines rental period type based on number of days
 */
export type RentalPeriodType = 'daily' | 'weekly' | 'monthly';

export function getRentalPeriodType(days: number): RentalPeriodType {
	if (days <= 7) {
		return 'daily';
	} else if (days <= 30) {
		return 'weekly';
	} else {
		return 'monthly';
	}
}

/**
 * Reservation State Machine
 * Defines valid state transitions
 */
export type ReservationStatus = 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled';

const VALID_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
	pending: ['confirmed', 'cancelled'],
	confirmed: ['active', 'cancelled'],
	active: ['completed', 'cancelled'],
	completed: [],
	cancelled: []
};

/**
 * Validates if a state transition is allowed
 */
export function isValidStateTransition(
	currentStatus: ReservationStatus,
	nextStatus: ReservationStatus
): boolean {
	// eslint-disable-next-line security/detect-object-injection
	return VALID_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

/**
 * Gets all possible next states for a given status
 */
export function getValidNextStates(status: ReservationStatus): ReservationStatus[] {
	// eslint-disable-next-line security/detect-object-injection
	return VALID_TRANSITIONS[status] ?? [];
}

/**
 * Validates reservation request input
 */
export interface ReservationInput {
	productId: string;
	startDate: string;
	endDate: string;
}

export interface ValidationError {
	field: string;
	message: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateReservationInput(input: ReservationInput): ValidationError[] {
	const errors: ValidationError[] = [];

	// Validate product ID (UUID format)
	if (!input.productId || !UUID_RE.test(input.productId)) {
		errors.push({
			field: 'productId',
			message: 'Product ID must be a valid UUID'
		});
	}

	// Validate dates
	if (!isValidDateFormat(input.startDate)) {
		errors.push({
			field: 'startDate',
			message: 'Start date must be in YYYY-MM-DD format'
		});
	}

	if (!isValidDateFormat(input.endDate)) {
		errors.push({
			field: 'endDate',
			message: 'End date must be in YYYY-MM-DD format'
		});
	}

	// Validate date range only if both dates are valid
	if (isValidDateFormat(input.startDate) && isValidDateFormat(input.endDate)) {
		if (!isValidDateRange(input.startDate, input.endDate)) {
			errors.push({
				field: 'dateRange',
				message: 'End date must be after start date'
			});
		}

		// Validate date is not in the past
		const startDate = new Date(input.startDate);
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		if (startDate < today) {
			errors.push({
				field: 'startDate',
				message: 'Start date cannot be in the past'
			});
		}
	}

	return errors;
}

/**
 * Price calculation helpers
 */
export interface PriceBreakdown {
	basePrice: number;
	rentalDays: number;
	rentalPeriodType: RentalPeriodType;
	subtotal: number;
	discountRate: number;
	discountAmount: number;
	finalAmount: number;
}

export function calculateReservationPrice(
	basePriceDaily: number,
	basePriceWeekly: number,
	basePriceMonthly: number,
	startDate: string,
	endDate: string,
	discountRate: number = 0
): PriceBreakdown {
	const rentalDays = calculateDays(startDate, endDate);
	const periodType = getRentalPeriodType(rentalDays);

	let subtotal: number;

	switch (periodType) {
		case 'daily': {
			subtotal = basePriceDaily * rentalDays;
			break;
		}
		case 'weekly': {
			const weeks = rentalDays / 7;
			subtotal = basePriceWeekly * weeks;
			break;
		}
		case 'monthly': {
			const months = rentalDays / 30;
			subtotal = basePriceMonthly * months;
			break;
		}
	}

	const discountAmount = subtotal * (discountRate / 100);
	const finalAmount = subtotal - discountAmount;

	return {
		basePrice: basePriceDaily,
		rentalDays,
		rentalPeriodType: periodType,
		subtotal,
		discountRate,
		discountAmount,
		finalAmount
	};
}

/**
 * 대여수량(qty) 다중예약 오케스트레이션 (2026-08-17)
 * 동일 상품 여러 대를 하나의 예약(주문)으로 묶어 예약하는 기능 — 신규 RPC 없이 기존
 * create_hold_reservation/create_draft_reservation을 qty회 반복 호출하는 방식으로 구현한다.
 * 호출 자체(RPC 통신)는 주입받은 deps가 담당하므로 이 함수는 순수 오케스트레이션 로직만 갖는다.
 */
export const MAX_RESERVATION_QTY = 10;

/** qty 입력값을 1~MAX_RESERVATION_QTY 범위로 보정 (무제한 반복호출 방지) */
export function clampReservationQty(qty: number): number {
	if (!Number.isFinite(qty) || qty < 1) return 1;
	return Math.min(Math.floor(qty), MAX_RESERVATION_QTY);
}

export interface UnitReservationResult {
	success: boolean;
	reservationId: number | null;
	errorMessage: string | null;
}

export interface MultiUnitReservationDeps {
	/** 재고 1대분 예약 생성(create_hold_reservation 또는 create_draft_reservation 1회 호출) */
	createUnit: () => Promise<UnitReservationResult>;
	/** 이미 생성된 예약 1건 취소(롤백용) */
	cancelUnit: (reservationId: number) => Promise<void>;
}

export interface MultiUnitReservationOutcome {
	success: boolean;
	reservationIds: number[];
	errorMessage: string | null;
}

/**
 * qty대를 순차적으로 예약 생성한다. 도중 하나라도 실패하면(재고 부족 등) 이미 생성된 건을
 * 전부 롤백하고 실패를 반환한다(all-or-nothing) — 부분 성공 상태로 남기지 않는다.
 */
export async function createMultiUnitReservation(
	qty: number,
	deps: MultiUnitReservationDeps
): Promise<MultiUnitReservationOutcome> {
	const targetQty = clampReservationQty(qty);
	const created: number[] = [];

	for (let i = 0; i < targetQty; i++) {
		const result = await deps.createUnit();

		if (!result.success || result.reservationId == null) {
			for (const id of created) {
				await deps.cancelUnit(id);
			}
			const errorMessage =
				created.length > 0
					? `요청하신 ${targetQty}대 중 ${created.length}대만 예약 가능해 전체 취소되었습니다. ${result.errorMessage ?? '재고가 부족합니다.'}`
					: (result.errorMessage ?? '예약 가능한 재고가 없습니다.');
			return { success: false, reservationIds: [], errorMessage };
		}

		created.push(result.reservationId);
	}

	return { success: true, reservationIds: created, errorMessage: null };
}

/**
 * 장바구니 동일 부모상품 중복담기 병합 (2026-08-28)
 * 상품상세에서 같은 부모상품을 두 번째 담을 때, 기존에 카트에 있는 예약과 병합하기 위한
 * 순수 헬퍼 2개. DB 조회 자체는 find_matching_cart_reservation_group RPC가 담당하고,
 * 이 함수들은 그 결과를 가공하는 순수 로직만 갖는다.
 */

export interface ParentResolvableProduct {
	id: string;
	parent_product_id?: string | null;
}

/** hold 행은 product_id가 배정된 자식(재고단위) UUID, draft 행은 부모 UUID 그대로 —
 *  항상 이 함수로 부모 id를 해석해야 병합 키가 일관된다. */
export function resolveParentProductId(product: ParentResolvableProduct | null | undefined): string | null {
	if (!product) return null;
	return product.parent_product_id ?? product.id;
}

export interface ReservationOptionInput {
	option_product_id: string | null;
	option_name: string;
	qty: number;
	unit_price: number;
}

/**
 * 기존(existing) 옵션 목록에 새로 선택한(incoming) 옵션을 병합한다.
 * - option_product_id가 같으면 qty를 합산하고 이름/단가는 incoming 값으로 갱신(최신 제출값 우선)
 * - incoming에만 있는 옵션은 새로 추가, existing에만 있는 옵션은 그대로 보존
 * - option_product_id가 null인 항목은 병합 대상에서 제외하고 항상 별도 유지(중복 판단 불가)
 */
export function mergeReservationOptions(
	existing: ReservationOptionInput[],
	incoming: ReservationOptionInput[]
): ReservationOptionInput[] {
	const merged: ReservationOptionInput[] = [];
	const indexByProductId = new Map<string, number>();

	for (const opt of existing) {
		if (opt.option_product_id == null) {
			merged.push({ ...opt });
			continue;
		}
		indexByProductId.set(opt.option_product_id, merged.length);
		merged.push({ ...opt });
	}

	for (const opt of incoming) {
		if (opt.option_product_id == null) {
			merged.push({ ...opt });
			continue;
		}
		const idx = indexByProductId.get(opt.option_product_id);
		if (idx == null) {
			indexByProductId.set(opt.option_product_id, merged.length);
			merged.push({ ...opt });
		} else {
			const prev = merged[idx];
			merged[idx] = {
				option_product_id: opt.option_product_id,
				option_name: opt.option_name,
				qty: prev.qty + opt.qty,
				unit_price: opt.unit_price
			};
		}
	}

	return merged;
}
