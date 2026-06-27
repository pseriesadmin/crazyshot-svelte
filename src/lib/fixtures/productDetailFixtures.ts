import type { Product } from '$lib/types/database';

/** v5.46 UUID 시드 DB 전용 — 레거시 숫자 id DB(crazyshot-stage 현행)에서는 id=9 그대로 조회 */
const V546_CANON_R5_UUID = '00000000-0000-0000-0000-000000000001';

/** v5.46 DB에서만: URL 숫자 id → UUID (현재는 9 → Canon R5만) */
export function mapLegacyProductIdToUuid(rawId: string): string | null {
	if (rawId === '9') return V546_CANON_R5_UUID;
	return null;
}

export function isLegacyNumericId(value: string): boolean {
	return /^\d+$/.test(value);
}

export type ProductDetailRow = Product & {
	base_price_daily: number;
};

/** 로컬 dev 전용 — DB 연결 실패 시 UI 확인 (id=9 / Canon EOS R5) */
export const CANON_EOS_R5_FIXTURE: ProductDetailRow = {
	id: '9',
	category: 'camera',
	name: 'Canon EOS R5',
	slug: 'canon-eos-r5',
	brand: 'Canon',
	description: '4500만 화소 풀프레임 미러리스. 8K RAW·IBIS·듀얼 카드슬롯.',
	image_urls: ['/sample/product-main.png'],
	specifications: {
		sensor: 'Full Frame CMOS',
		megapixels: '45MP',
		video: '8K RAW',
	},
	is_active: true,
	base_price_daily: 85000,
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-01-01T00:00:00.000Z',
	deleted_at: null,
};

export function resolveProductLookupId(rawId: string): string {
	return mapLegacyProductIdToUuid(rawId) ?? rawId;
}

export function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
