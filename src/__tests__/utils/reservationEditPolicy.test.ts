import { describe, it, expect } from 'vitest';
import {
	canEditSubmittedReservation,
	type ReservationEditInput
} from '$lib/utils/reservationEditPolicy';

type Sibling = ReservationEditInput['siblings'][number];

const sib = (over: Partial<Sibling> = {}): Sibling => ({
	id: 'r1',
	signed_at: null,
	payment_confirmed_at: null,
	...over
});

const base = (over: Partial<ReservationEditInput> = {}): ReservationEditInput => ({
	reservation_id: 'r1',
	status: 'hold',
	cancel_requested_at: null,
	siblings: [sib({ id: 'r1' }), sib({ id: 'r2' })],
	direct_pay_expires_at: null,
	...over
});

const T = '2026-11-11T01:00:00.000Z';

describe('canEditSubmittedReservation', () => {
	describe('Happy', () => {
		it('hold + 형제 전체 미서명·미결제 + 취소요청·직접결제 없음 → ok', () => {
			expect(canEditSubmittedReservation(base())).toEqual({ canEdit: true, reason: 'ok' });
		});
		it('단독 예약(siblings=대상 자신 1건)도 ok', () => {
			expect(canEditSubmittedReservation(base({ siblings: [sib({ id: 'r1' })] }))).toEqual({
				canEdit: true,
				reason: 'ok'
			});
		});
	});

	describe('Edge — 주문 단위(형제 전체) 판정', () => {
		it('형제 2건 중 1건만 signed → SIGNED', () => {
			const r = canEditSubmittedReservation(
				base({ siblings: [sib({ id: 'r1' }), sib({ id: 'r2', signed_at: T })] })
			);
			expect(r).toEqual({ canEdit: false, reason: 'SIGNED' });
		});
		it('SIGNED가 첫 원소여도 → SIGNED (위치 무관)', () => {
			const r = canEditSubmittedReservation(
				base({ siblings: [sib({ id: 'r2', signed_at: T }), sib({ id: 'r1' })] })
			);
			expect(r).toEqual({ canEdit: false, reason: 'SIGNED' });
		});
		it('PAID가 두 번째 원소여도 → PAID (위치 무관)', () => {
			const r = canEditSubmittedReservation(
				base({ siblings: [sib({ id: 'r1' }), sib({ id: 'r2', payment_confirmed_at: T })] })
			);
			expect(r).toEqual({ canEdit: false, reason: 'PAID' });
		});
		it('형제 무서명이나 1건 payment_confirmed → PAID', () => {
			const r = canEditSubmittedReservation(
				base({ siblings: [sib({ id: 'r1', payment_confirmed_at: T }), sib({ id: 'r2' })] })
			);
			expect(r).toEqual({ canEdit: false, reason: 'PAID' });
		});
		it('SIGNED + PAID 동시 → SIGNED 우선', () => {
			const r = canEditSubmittedReservation(
				base({
					siblings: [sib({ id: 'r1', signed_at: T }), sib({ id: 'r2', payment_confirmed_at: T })]
				})
			);
			expect(r).toEqual({ canEdit: false, reason: 'SIGNED' });
		});
		it('한 건에 signed·paid 동시 → SIGNED 우선', () => {
			const r = canEditSubmittedReservation(
				base({ siblings: [sib({ signed_at: T, payment_confirmed_at: T })] })
			);
			expect(r.reason).toBe('SIGNED');
		});
	});

	describe('Error — 거절 사유', () => {
		it('cancel_requested_at 있음 → CANCEL_REQUESTED', () => {
			expect(canEditSubmittedReservation(base({ cancel_requested_at: T }))).toEqual({
				canEdit: false,
				reason: 'CANCEL_REQUESTED'
			});
		});
		it('status expired → EXPIRED (NOT_HOLD 아님)', () => {
			expect(canEditSubmittedReservation(base({ status: 'expired' }))).toEqual({
				canEdit: false,
				reason: 'EXPIRED'
			});
		});
		it('direct_pay_expires_at 있음 → DIRECT_PAY', () => {
			expect(canEditSubmittedReservation(base({ direct_pay_expires_at: T }))).toEqual({
				canEdit: false,
				reason: 'DIRECT_PAY'
			});
		});
		it.each(['confirmed', 'cancelled', 'completed', 'pending', '', 'HOLD', ' hold'])(
			'status %s → NOT_HOLD',
			status => {
				expect(canEditSubmittedReservation(base({ status }))).toEqual({
					canEdit: false,
					reason: 'NOT_HOLD'
				});
			}
		);
		it('우선순위: SIGNED > PAID > CANCEL_REQUESTED > EXPIRED > DIRECT_PAY > NOT_HOLD', () => {
			const all = base({
				status: 'expired',
				cancel_requested_at: T,
				direct_pay_expires_at: T,
				siblings: [sib({ signed_at: T, payment_confirmed_at: T })]
			});
			expect(canEditSubmittedReservation(all).reason).toBe('SIGNED');
			expect(
				canEditSubmittedReservation({
					...all,
					siblings: [sib({ payment_confirmed_at: T })]
				}).reason
			).toBe('PAID');
			expect(canEditSubmittedReservation({ ...all, siblings: [sib()] }).reason).toBe(
				'CANCEL_REQUESTED'
			);
			expect(
				canEditSubmittedReservation({ ...all, siblings: [sib()], cancel_requested_at: null }).reason
			).toBe('EXPIRED');
			expect(
				canEditSubmittedReservation({
					...all,
					siblings: [sib()],
					cancel_requested_at: null,
					status: 'hold'
				}).reason
			).toBe('DIRECT_PAY');
			expect(
				canEditSubmittedReservation({
					...all,
					siblings: [sib()],
					cancel_requested_at: null,
					direct_pay_expires_at: null,
					status: 'confirmed'
				}).reason
			).toBe('NOT_HOLD');
		});
		it('ERROR가 모든 사유보다 우선 (필드 누락 + signed)', () => {
			const input = base({
				siblings: [sib({ id: 'r1', signed_at: T }), { id: 'r2' } as unknown as Sibling]
			});
			expect(canEditSubmittedReservation(input).reason).toBe('ERROR');
		});
	});

	describe('fail-closed — 대상 포함 검사(M1)', () => {
		it('siblings 빈 배열 → ERROR', () => {
			expect(canEditSubmittedReservation(base({ siblings: [] }))).toEqual({
				canEdit: false,
				reason: 'ERROR'
			});
		});
		it('대상 id가 없는 non-empty 목록 → ERROR', () => {
			expect(
				canEditSubmittedReservation(base({ siblings: [sib({ id: 'r2' }), sib({ id: 'r3' })] }))
			).toEqual({ canEdit: false, reason: 'ERROR' });
		});
		it('reservation_id 누락 → ERROR', () => {
			const input = { ...base(), reservation_id: undefined } as unknown as ReservationEditInput;
			expect(canEditSubmittedReservation(input).reason).toBe('ERROR');
		});
	});

	describe('fail-closed — null 엄격 비교(m1)', () => {
		it('형제 signed_at undefined → ERROR', () => {
			const bad = { id: 'r1', payment_confirmed_at: null } as unknown as Sibling;
			expect(canEditSubmittedReservation(base({ siblings: [bad] })).reason).toBe('ERROR');
		});
		it('형제 payment_confirmed_at undefined → ERROR', () => {
			const bad = { id: 'r1', signed_at: null } as unknown as Sibling;
			expect(canEditSubmittedReservation(base({ siblings: [bad] })).reason).toBe('ERROR');
		});
		it('cancel_requested_at undefined → ERROR', () => {
			const input = {
				...base(),
				cancel_requested_at: undefined
			} as unknown as ReservationEditInput;
			expect(canEditSubmittedReservation(input).reason).toBe('ERROR');
		});
		it('direct_pay_expires_at undefined → ERROR', () => {
			const input = {
				...base(),
				direct_pay_expires_at: undefined
			} as unknown as ReservationEditInput;
			expect(canEditSubmittedReservation(input).reason).toBe('ERROR');
		});
		it('signed_at 빈 문자열 → SIGNED', () => {
			expect(
				canEditSubmittedReservation(base({ siblings: [sib({ id: 'r1', signed_at: '' })] })).reason
			).toBe('SIGNED');
		});
		it('payment_confirmed_at 빈 문자열 → PAID', () => {
			expect(
				canEditSubmittedReservation(
					base({ siblings: [sib({ id: 'r1', payment_confirmed_at: '' })] })
				).reason
			).toBe('PAID');
		});
		it('cancel_requested_at 빈 문자열 → CANCEL_REQUESTED', () => {
			expect(canEditSubmittedReservation(base({ cancel_requested_at: '' })).reason).toBe(
				'CANCEL_REQUESTED'
			);
		});
		it('direct_pay_expires_at 빈 문자열 → DIRECT_PAY', () => {
			expect(canEditSubmittedReservation(base({ direct_pay_expires_at: '' })).reason).toBe(
				'DIRECT_PAY'
			);
		});
	});

	describe('fail-closed', () => {
		it('입력 null → ERROR', () => {
			expect(canEditSubmittedReservation(null)).toEqual({ canEdit: false, reason: 'ERROR' });
		});
		it('siblings null → ERROR', () => {
			const input = { ...base(), siblings: null } as unknown as ReservationEditInput;
			expect(canEditSubmittedReservation(input)).toEqual({ canEdit: false, reason: 'ERROR' });
		});
		it('siblings undefined → ERROR', () => {
			const input = { ...base(), siblings: undefined } as unknown as ReservationEditInput;
			expect(canEditSubmittedReservation(input)).toEqual({ canEdit: false, reason: 'ERROR' });
		});
		it('siblings가 배열 아님 → ERROR', () => {
			const input = { ...base(), siblings: {} } as unknown as ReservationEditInput;
			expect(canEditSubmittedReservation(input).reason).toBe('ERROR');
		});
		it('siblings 원소가 null(접근 시 throw) → ERROR', () => {
			const input = { ...base(), siblings: [null] } as unknown as ReservationEditInput;
			expect(canEditSubmittedReservation(input)).toEqual({ canEdit: false, reason: 'ERROR' });
		});
		it('필드 getter가 throw → ERROR (예외를 밖으로 내보내지 않음)', () => {
			const input = base();
			Object.defineProperty(input, 'status', {
				get() {
					throw new Error('boom');
				}
			});
			expect(canEditSubmittedReservation(input)).toEqual({ canEdit: false, reason: 'ERROR' });
		});
	});
});
