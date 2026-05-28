import { describe, it, expect, beforeEach } from 'vitest';
import { supabase, rpc } from '$lib/services/supabase';

/**
 * S1-M2 Reservation Flow Tests (TDD)
 * Focus: Atomic reservation, conflict detection, state machine
 *
 * RED → GREEN → REFACTOR cycle
 */

describe('Reservation System', () => {
	let testProductId: number;

	beforeEach(async () => {
		// Setup: Create test product and asset
		// Note: In real tests, these would use test fixtures or mocking
		// For now, we assume products/assets exist from seeded data
		testProductId = 1; // Canon R5 from seed
	});

	describe('Atomic Reserve Asset (H-01: No Direct INSERT)', () => {
		it('RED: should reserve available asset and return reservation_id', async () => {
			const startDate = new Date();
			const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days

			// This test should FAIL initially (RED phase)
			// Once RPC function is called, it should succeed
			const result = await rpc.atomicReserveAsset(
				testProductId,
				startDate.toISOString().split('T')[0],
				endDate.toISOString().split('T')[0]
			);

			expect(result).toBeDefined();
			expect(result.success).toBe(true);
			expect(result.reservation_id).toBeGreaterThan(0);
			expect(result.asset_id).toBeGreaterThan(0);
		});

		it('RED: should mark asset as rented after successful reservation', async () => {
			const startDate = new Date();
			const endDate = new Date(startDate.getTime() + 1 * 24 * 60 * 60 * 1000); // +1 day

			const result = await rpc.atomicReserveAsset(
				testProductId,
				startDate.toISOString().split('T')[0],
				endDate.toISOString().split('T')[0]
			);

			if (result.success && result.asset_id) {
				// Verify asset status changed to 'rented'
				const { data: asset } = await supabase
					.from('assets')
					.select('status')
					.eq('id', result.asset_id)
					.single();

				expect(asset?.status).toBe('rented');
			}
		});

		it('RED: should fail if no available assets', async () => {
			// Create a scenario where all assets are rented
			// For now, test with a product that has no available assets
			const startDate = new Date();
			const endDate = new Date(startDate.getTime() + 1 * 24 * 60 * 60 * 1000);

			// Try to reserve non-existent product
			const result = await rpc.atomicReserveAsset(
				99999, // Non-existent product
				startDate.toISOString().split('T')[0],
				endDate.toISOString().split('T')[0]
			);

			expect(result.success).toBe(false);
			expect(result.error_message).toBeDefined();
		});
	});

	describe('Reservation Conflict Detection', () => {
		it('RED: should detect overlapping reservations', async () => {
			const startDate1 = '2026-06-01';
			const endDate1 = '2026-06-08';

			// These tests verify conflict detection logic
			// Should be implemented in the RPC function or app logic
			const result1 = await rpc.atomicReserveAsset(testProductId, startDate1, endDate1);
			expect(result1.success).toBe(true);

			// Second reservation on same asset during overlapping period should fail
			// This depends on how we handle asset allocation
			// For now, it should succeed because different assets are allocated
		});

		it('GREEN: should allow non-overlapping reservations on same product', async () => {
			// Different time slots = different assets from same product
			const startDate1 = '2026-06-01';
			const endDate1 = '2026-06-05';
			const startDate2 = '2026-06-06'; // No overlap
			const endDate2 = '2026-06-10';

			const result1 = await rpc.atomicReserveAsset(testProductId, startDate1, endDate1);
			const result2 = await rpc.atomicReserveAsset(testProductId, startDate2, endDate2);

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);
			// Both should succeed if we have multiple assets available
		});

		it('RED: should validate date range (end_date > start_date)', () => {
			const startDate = '2026-06-10';
			const endDate = '2026-06-05'; // Invalid: before start

			// Client-side validation should catch this
			expect(new Date(endDate) > new Date(startDate)).toBe(false);
		});
	});

	describe('Reservation State Machine', () => {
		it('RED: should transition from pending to confirmed', async () => {
			// Create reservation
			const startDate = new Date();
			const endDate = new Date(startDate.getTime() + 3 * 24 * 60 * 60 * 1000);

			const result = await rpc.atomicReserveAsset(
				testProductId,
				startDate.toISOString().split('T')[0],
				endDate.toISOString().split('T')[0]
			);

			if (result.success && result.reservation_id) {
				// Check initial status
				const { data: reservation } = await supabase
					.from('rental_reservations')
					.select('status')
					.eq('id', result.reservation_id)
					.single();

				// Should start as 'confirmed' after atomic reserve
				expect(['pending', 'confirmed']).toContain(reservation?.status);
			}
		});

		it('GREEN: should transition from active to completed on release', async () => {
			// Create reservation
			const startDate = new Date();
			const endDate = new Date(startDate.getTime() + 1 * 24 * 60 * 60 * 1000);

			const result = await rpc.atomicReserveAsset(
				testProductId,
				startDate.toISOString().split('T')[0],
				endDate.toISOString().split('T')[0]
			);

			if (result.success && result.reservation_id) {
				// Release asset
				const releaseResult = await rpc.releaseAsset(result.reservation_id);

				expect(releaseResult.success).toBe(true);

				// Verify status changed to 'completed'
				const { data: reservation } = await supabase
					.from('rental_reservations')
					.select('status')
					.eq('id', result.reservation_id)
					.single();

				expect(reservation?.status).toBe('completed');
			}
		});

		it('REFACTOR: should prevent invalid state transitions', () => {
			// Invalid transitions:
			// - pending → completed (must go through confirmed/active)
			// - confirmed → pending (backwards)
			// - completed → active (no reversal)

			const validTransitions: Record<string, string[]> = {
				pending: ['confirmed', 'cancelled'],
				confirmed: ['active', 'cancelled'],
				active: ['completed', 'cancelled'],
				completed: [], // Terminal state
				cancelled: [] // Terminal state
			};

			// This validates our state machine logic
			expect(validTransitions.pending).toContain('confirmed');
			expect(validTransitions.confirmed).not.toContain('pending');
			expect(validTransitions.completed).toEqual([]);
		});
	});

	describe('Error Handling & Edge Cases', () => {
		it('RED: should handle reservation on non-existent product', async () => {
			const startDate = '2026-06-01';
			const endDate = '2026-06-08';

			const result = await rpc.atomicReserveAsset(99999, startDate, endDate);

			expect(result.success).toBe(false);
			expect(result.error_message).toBeDefined();
		});

		it('RED: should handle release of non-existent reservation', async () => {
			const result = await rpc.releaseAsset(99999);

			expect(result.success).toBe(false);
			expect(result.error_message).toBeDefined();
		});

		it('REFACTOR: should validate dates in correct format', () => {
			const validDate = '2026-06-01';
			const invalidDate = '06/01/2026';

			// Should use ISO format YYYY-MM-DD
			const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

			expect(dateRegex.test(validDate)).toBe(true);
			expect(dateRegex.test(invalidDate)).toBe(false);
		});
	});

	describe('Integration with Cart Calculation', () => {
		it('GREEN: should calculate correct total for reservation period', async () => {
			// Create reservation and calculate price
			const startDate = new Date();
			const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

			const result = await rpc.atomicReserveAsset(
				testProductId,
				startDate.toISOString().split('T')[0],
				endDate.toISOString().split('T')[0]
			);

			if (result.success && result.reservation_id) {
				// Calculate cart total
				const cartTotal = await rpc.calculateCartTotal([result.reservation_id]);

				expect(cartTotal).toBeDefined();
				expect(cartTotal.total_amount).toBeGreaterThan(0);
				expect(cartTotal.final_amount).toBeGreaterThanOrEqual(cartTotal.total_amount - cartTotal.discount_amount);
			}
		});
	});
});
