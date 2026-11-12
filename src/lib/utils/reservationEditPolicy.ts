// 신청대기(hold) 예약의 예약정보 수정 가능 여부 판정 (순수 함수, DB 접근 없음)
// 판정은 주문 단위 — 같은 주문의 형제 예약 전체를 기준으로 한다. 불확실하면 항상 수정 불가(fail-closed).
// 호출부 계약: siblings = 대상 자신을 포함한 같은 주문 전체, 계약서 signed_at은 주문 대표 예약(MIN id) 기준값을 각 형제에 반영해 넣을 것.
// 시각 필드는 명시적 null만 '없음', undefined(누락)는 ERROR, 그 외 값(빈 문자열 포함)은 '있음'으로 본다.

export interface ReservationEditInput {
	reservation_id: string;
	status: string;
	cancel_requested_at: string | null;
	siblings: Array<{
		id: string;
		signed_at: string | null;
		payment_confirmed_at: string | null;
	}>;
	direct_pay_expires_at: string | null;
}

export type EditReason =
	| 'ok'
	| 'SIGNED'
	| 'PAID'
	| 'CANCEL_REQUESTED'
	| 'EXPIRED'
	| 'DIRECT_PAY'
	| 'ERROR'
	| 'NOT_HOLD';

export interface EditabilityResult {
	canEdit: boolean;
	reason: EditReason;
}

const deny = (reason: Exclude<EditReason, 'ok'>): EditabilityResult => ({ canEdit: false, reason });

export function canEditSubmittedReservation(input: ReservationEditInput | null): EditabilityResult {
	try {
		if (!input || !Array.isArray(input.siblings)) return deny('ERROR');

		const { reservation_id, siblings } = input;
		if (typeof reservation_id !== 'string' || reservation_id === '') return deny('ERROR');
		if (!siblings.some(s => s.id === reservation_id)) return deny('ERROR');
		if (siblings.some(s => s.signed_at === undefined || s.payment_confirmed_at === undefined)) {
			return deny('ERROR');
		}
		if (input.cancel_requested_at === undefined || input.direct_pay_expires_at === undefined) {
			return deny('ERROR');
		}

		if (siblings.some(s => s.signed_at !== null)) return deny('SIGNED');
		if (siblings.some(s => s.payment_confirmed_at !== null)) return deny('PAID');
		if (input.cancel_requested_at !== null) return deny('CANCEL_REQUESTED');
		if (input.status === 'expired') return deny('EXPIRED');
		if (input.direct_pay_expires_at !== null) return deny('DIRECT_PAY');
		if (input.status !== 'hold') return deny('NOT_HOLD');

		return { canEdit: true, reason: 'ok' };
	} catch {
		return deny('ERROR');
	}
}
