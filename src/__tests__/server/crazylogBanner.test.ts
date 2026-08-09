import { describe, it, expect } from 'vitest'
import { pickBannerItems, deriveBadgeLabel, type BannerPost } from '$lib/utils/crazylogBanner'

const post = (id: string, logType: string | null): BannerPost => ({
	id,
	title: id,
	logType,
	img: null,
	desc: null,
})

describe('pickBannerItems', () => {
	it('fixed 모드는 order 순으로 최대 max개 반환', () => {
		const pool = [post('a', '상품리뷰'), post('b', '일상공유'), post('c', '채널홍보')]
		const result = pickBannerItems(
			pool,
			{ posts: [{ id: 'c', order: 0 }, { id: 'a', order: 1 }, { id: 'b', order: 2 }], mode: 'fixed' },
			2,
			(arr) => arr
		)
		expect(result.map((p) => p.id)).toEqual(['c', 'a'])
	})

	it('fixed 모드는 pool에 없는 id를 무시', () => {
		const pool = [post('a', '상품리뷰')]
		const result = pickBannerItems(
			pool,
			{ posts: [{ id: 'a', order: 0 }, { id: 'ghost', order: 1 }], mode: 'fixed' },
			3,
			(arr) => arr
		)
		expect(result.map((p) => p.id)).toEqual(['a'])
	})

	it('random 모드는 shuffle 결과를 max개로 슬라이스', () => {
		const pool = [post('a', '상품리뷰'), post('b', '일상공유'), post('c', '채널홍보')]
		const reversed = <T>(arr: T[]) => [...arr].reverse()
		const result = pickBannerItems(pool, { posts: [], mode: 'random' }, 2, reversed)
		expect(result.map((p) => p.id)).toEqual(['c', 'b'])
	})

	it('풀이 max보다 적으면 전체 반환', () => {
		const pool = [post('a', '상품리뷰')]
		const result = pickBannerItems(pool, { posts: [], mode: 'random' }, 3, (arr) => arr)
		expect(result).toHaveLength(1)
	})
})

describe('deriveBadgeLabel', () => {
	it('다수 log_type을 배지로 반환', () => {
		const items = [post('a', '채널홍보'), post('b', '채널홍보'), post('c', '상품리뷰')]
		expect(deriveBadgeLabel(items, 'CrazyLog')).toBe('채널홍보')
	})

	it('동률이면 0번 인덱스 항목의 log_type 반환', () => {
		const items = [post('a', '일상공유'), post('b', '채널홍보')]
		expect(deriveBadgeLabel(items, 'CrazyLog')).toBe('일상공유')
	})

	it('빈 배열이면 fallback 반환', () => {
		expect(deriveBadgeLabel([], 'CrazyLog')).toBe('CrazyLog')
	})

	it('logType이 null이면 fallback으로 카운트', () => {
		const items = [post('a', null), post('b', null), post('c', '채널홍보')]
		expect(deriveBadgeLabel(items, 'CrazyLog')).toBe('CrazyLog')
	})
})
