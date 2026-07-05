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
