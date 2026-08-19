import { describe, it, expect } from 'vitest';
import { isRealMemberSession } from '$lib/utils/authGuard';

describe('isRealMemberSession', () => {
	it('세션이 없으면(null) false를 반환한다', () => {
		expect(isRealMemberSession(null)).toBe(false);
	});

	it('세션이 없으면(undefined) false를 반환한다', () => {
		expect(isRealMemberSession(undefined)).toBe(false);
	});

	it('익명 세션(user.is_anonymous=true)이면 false를 반환한다', () => {
		expect(isRealMemberSession({ user: { is_anonymous: true } })).toBe(false);
	});

	it('실제 가입 완료 세션(is_anonymous 미설정)이면 true를 반환한다', () => {
		expect(isRealMemberSession({ user: {} })).toBe(true);
	});

	it('실제 가입 완료 세션(is_anonymous=false 명시)이면 true를 반환한다', () => {
		expect(isRealMemberSession({ user: { is_anonymous: false } })).toBe(true);
	});

	it('user가 없는 세션 객체는 false를 반환한다', () => {
		expect(isRealMemberSession({ user: null })).toBe(false);
	});
});
