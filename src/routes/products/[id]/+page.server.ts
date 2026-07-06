import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	CANON_EOS_R5_FIXTURE,
	isLegacyNumericId,
	isUuid,
	mapLegacyProductIdToUuid,
	type ProductDetailRow,
} from '$lib/fixtures/productDetailFixtures';
import type { Database, ProductOptionLinkRow } from '$lib/types/database';
import type { PageServerLoad } from './$types';

type ProductRow = Database['public']['Tables']['products']['Row'] & Record<string, unknown>;

async function attachDailyPrice(
	supabase: SupabaseClient<Database>,
	product: ProductRow,
): Promise<ProductDetailRow> {
	const legacyDaily = product.base_price_daily;
	if (legacyDaily != null && legacyDaily !== '') {
		return {
			...product,
			base_price_daily: Number(legacyDaily),
		};
	}

	const { data: rule, error: ruleError } = await supabase
		.from('price_rules')
		.select('price')
		.eq('product_id', product.id)
		.eq('duration_type', '24h')
		.eq('is_active', true)
		.is('deleted_at', null)
		.maybeSingle();

	if (ruleError) {
		console.error('[products/[id]] price_rules error:', ruleError.message);
	}

	const rulePrice = rule as { price: number | string } | null;

	return {
		...product,
		base_price_daily: rulePrice?.price != null ? Number(rulePrice.price) : 0,
	};
}

function devFallbackForLegacyNine(rawId: string): { product: ProductDetailRow; productId: string } | null {
	if (!dev || rawId !== '9') return null;
	return {
		product: CANON_EOS_R5_FIXTURE,
		productId: '9',
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const rawId = params.id;

	let query = locals.supabase.from('products').select('*');

	if (isLegacyNumericId(rawId)) {
		// crazyshot-stage / 실서비스형 — 숫자 id (예: 9)
		query = query.eq('id', Number(rawId));
	} else if (isUuid(rawId)) {
		query = query.eq('id', rawId);
	} else {
		const mappedUuid = mapLegacyProductIdToUuid(rawId);
		if (mappedUuid) {
			query = query.eq('id', mappedUuid);
		} else {
			query = query.eq('slug', rawId);
		}
	}

	const { data: product, error: fetchError } = await query.maybeSingle();

	if (fetchError) {
		console.error('[products/[id]] Supabase error:', fetchError.message);
		const fallback = devFallbackForLegacyNine(rawId);
		if (fallback) return fallback;
		error(503, '일시적으로 상품 정보를 불러올 수 없습니다. Supabase 연결을 확인해 주세요.');
	}

	if (!product) {
		const fallback = devFallbackForLegacyNine(rawId);
		if (fallback) return fallback;
		error(404, '상품을 찾을 수 없습니다.');
	}

	const row = product as ProductRow;
	const enriched = await attachDailyPrice(locals.supabase, row);

	// 옵션상품 링크 조회 (RPC 없으면 빈 배열 fallback)
	let optionLinks: ProductOptionLinkRow[] = [];
	if (isUuid(String(row.id))) {
		// get_product_option_links is not yet registered in Database type; cast through unknown
		type RpcFn = (name: string, args: Record<string, string>) => ReturnType<typeof locals.supabase.rpc>;
		const { data: links, error: linksError } = await (locals.supabase.rpc as unknown as RpcFn)(
			'get_product_option_links',
			{ p_product_id: String(row.id) },
		);
		if (!linksError) {
			optionLinks = (links ?? []) as ProductOptionLinkRow[];
		}
	}

	return {
		product: enriched,
		productId: String(row.id),
		optionLinks,
	};
};
