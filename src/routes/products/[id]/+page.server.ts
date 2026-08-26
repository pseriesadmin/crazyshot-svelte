import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSupabaseUrl } from '$lib/env/supabasePublic';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCategoryGroups, joinDisplayCategories, type CatSettingsItem, type DisplayCategory } from '$lib/server/productCategorySettings';
import { getWishedProductIds } from '$lib/server/getWishedProductIds';
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

async function attachPrices(
	supabase: SupabaseClient<Database>,
	product: ProductRow,
): Promise<ProductDetailRow> {
	const { data: rules, error: rulesError } = await supabase
		.from('price_rules')
		.select('duration_type, price, deposit_amount')
		.eq('product_id', product.id)
		.eq('is_active', true)
		.is('deleted_at', null)
		.in('duration_type', ['12h', '24h']);

	if (rulesError) {
		console.error('[products/[id]] price_rules error:', rulesError.message);
	}

	const ruleArr = (rules ?? []) as { duration_type: string; price: number | string; deposit_amount: number | null }[];
	const rule24h = ruleArr.find((r) => r.duration_type === '24h');
	const rule12h = ruleArr.find((r) => r.duration_type === '12h');

	const legacyDaily = product.base_price_daily;
	const legacyNum = legacyDaily != null && legacyDaily !== '' ? Number(legacyDaily) : 0;
	const base_price_daily =
		legacyNum > 0
			? legacyNum
			: rule24h?.price != null ? Number(rule24h.price) : 0;

	return {
		...product,
		base_price_daily,
		base_price_12h: rule12h?.price != null ? Number(rule12h.price) : null,
		deposit_amount: rule24h?.deposit_amount != null ? Number(rule24h.deposit_amount) : null,
	};
}

function devFallbackForLegacyNine(rawId: string): { product: ProductDetailRow; productId: string; categoryLabel: string | null; wishedIds: string[]; isLoggedIn: boolean } | null {
	if (!dev || rawId !== '9') return null;
	return {
		product: CANON_EOS_R5_FIXTURE,
		productId: '9',
		categoryLabel: null,
		wishedIds: [],
		isLoggedIn: false,
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const rawId = params.id;
	const { session } = await locals.safeGetSession();

	let query = locals.supabase.from('products').select('*').is('parent_product_id', null);

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
		// 타입 불일치(숫자 ID → UUID 컬럼) 또는 존재하지 않는 레거시 ID → 404
		if (fetchError.code === '22P02' || isLegacyNumericId(rawId)) {
			error(404, '상품을 찾을 수 없습니다.');
		}
		error(503, '일시적으로 상품 정보를 불러올 수 없습니다. Supabase 연결을 확인해 주세요.');
	}

	if (!product) {
		const fallback = devFallbackForLegacyNine(rawId);
		if (fallback) return fallback;
		error(404, '상품을 찾을 수 없습니다.');
	}

	const row = product as ProductRow;
	const enriched = await attachPrices(locals.supabase, row);

	// 대여정책 — allowed_period_ids / allowed_method_ids (products 행에 저장된 ID 배열)
	const periodIds = ((row as unknown as Record<string, unknown>).allowed_period_ids as string[] | null) ?? [];
	const methodIds = ((row as unknown as Record<string, unknown>).allowed_method_ids as string[] | null) ?? [];

	type RentalOption = { id: string; name: string };
	type RentalMethodOption = { id: string; name: string; method_key: string | null };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyClient = locals.supabase as any;
	const [periodsRes, methodsRes, shippingSettingsRes] = await Promise.all([
		periodIds.length > 0
			? anyClient.from('rental_period_options').select('id, name').in('id', periodIds).eq('is_active', true)
			: Promise.resolve({ data: [] }),
		methodIds.length > 0
			? anyClient.from('rental_method_options').select('id, name, method_key').in('id', methodIds).eq('is_active', true)
			: Promise.resolve({ data: [] }),
		anyClient
			.from('rental_shipping_settings')
			.select('enable_round_trip, round_trip_fee, enable_delivery, delivery_fee, enable_return, return_fee, shipping_guide')
			.limit(1)
			.single(),
	]);
	const rentalPeriods: RentalOption[] = (periodsRes.data ?? []) as RentalOption[];
	const rentalMethods: RentalMethodOption[] = (methodsRes.data ?? []) as RentalMethodOption[];

	// 배송정책 — 상품별 ON 여부 × 전역 설정 교차
	type ShippingPolicyItem = { label: string; fee: number };
	type ShippingPolicy = { items: ShippingPolicyItem[]; guide: string } | null;
	let shippingPolicy: ShippingPolicy = null;
	const ss = shippingSettingsRes.data as {
		enable_round_trip: boolean; round_trip_fee: number | null;
		enable_delivery: boolean; delivery_fee: number | null;
		enable_return: boolean; return_fee: number | null;
		shipping_guide: string;
	} | null;
	if (shippingSettingsRes.error) {
		console.error('[products/[id]] rental_shipping_settings error:', shippingSettingsRes.error.message);
	}
	if (ss) {
		const pr = row as unknown as Record<string, unknown>;
		const items: ShippingPolicyItem[] = [];
		// [E-1] Boolean() 캐스트 — DB 컬럼 타입(bool/int/string) 무관하게 truthy 판단
		if (ss.enable_round_trip && Boolean(pr['shipping_round_trip']))
			items.push({ label: '왕복 요금', fee: ss.round_trip_fee ?? 0 });
		if (ss.enable_delivery && Boolean(pr['shipping_delivery']))
			items.push({ label: '배송요금', fee: ss.delivery_fee ?? 0 });
		if (ss.enable_return && Boolean(pr['shipping_return']))
			items.push({ label: '반송요금', fee: ss.return_fee ?? 0 });
		if (items.length > 0 || ss.shipping_guide) {
			shippingPolicy = { items, guide: ss.shipping_guide ?? '' };
		}
	}

	// 옵션상품 링크 조회 (RPC 없으면 빈 배열 fallback)
	let optionLinks: ProductOptionLinkRow[] = [];
	type RpcFn = (name: string, args: Record<string, unknown>) => ReturnType<typeof locals.supabase.rpc>;
	if (isUuid(String(row.id))) {
		// get_product_option_links is not yet registered in Database type; cast through unknown
		const { data: links, error: linksError } = await (locals.supabase.rpc as unknown as RpcFn)(
			'get_product_option_links',
			{ p_product_id: String(row.id) },
		);
		if (!linksError) {
			optionLinks = (links ?? []) as ProductOptionLinkRow[];
		}
	}

	// 상품 후기 목록 로드
	type ReviewItem = { id: string; author_name: string; title: string; content: string; created_at: string };
	let reviews: ReviewItem[] = [];
	if (isUuid(String(row.id))) {
		const { data: reviewData } = await (locals.supabase.rpc as unknown as RpcFn)(
			'get_product_reviews',
			{ p_product_id: String(row.id) },
		);
		reviews = (reviewData ?? []) as ReviewItem[];
	}

	// Shotlog: 최신 공개 게시글 5개
	type ShotlogItem = { id: string; title: string; author: string; img: string | null; createdAt: string };
	const { data: rawPosts } = await locals.supabase
		.from('user_posts')
		.select('id, title, log_type, content_blocks, created_at, user_id')
		.eq('status', 'published')
		.eq('is_public', true)
		.order('created_at', { ascending: false })
		.limit(5);

	const postRows = (rawPosts ?? []) as Array<{ id: string; title: string; log_type: string | null; content_blocks: unknown; created_at: string; user_id: string }>;
	const postUserIds = [...new Set(postRows.map((p) => p.user_id).filter(Boolean))];
	const authorMap: Record<string, string> = {};
	if (postUserIds.length > 0) {
		const { data: profiles } = await locals.supabase
			.from('user_profiles')
			.select('id, full_name')
			.in('id', postUserIds);
		for (const profile of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
			if (profile.id) authorMap[profile.id] = profile.full_name ?? '익명';
		}
	}

	function extractFirstImage(blocks: unknown): string | null {
		if (!Array.isArray(blocks)) return null;
		for (const b of blocks as Array<Record<string, unknown>>) {
			if (b.type === 'image' && Array.isArray(b.images) && b.images.length > 0) {
				const img = b.images[0] as { url?: string };
				if (img.url) return img.url;
			}
		}
		return null;
	}

	const shotlogs: ShotlogItem[] = postRows.map((p) => ({
		id:        p.id,
		title:     p.title,
		author:    authorMap[p.user_id] ?? '익명',
		img:       extractFirstImage(p.content_blocks),
		createdAt: p.created_at,
	}));

	// 많이 본 상품: 같은 카테고리 최신 5개 (현재 상품 제외)
	type PopularItem = { id: string; name: string; slug: string | null; imageUrl: string | null; price24h: number; category: string | null };
	let popularProducts: PopularItem[] = [];
	if (row.category) {
		const { data: popRaw } = await locals.supabase
			.from('products')
			.select('id, name, slug, image_urls, base_price_daily')
			.eq('category', row.category as string)
			.eq('is_active', true)
			.is('deleted_at', null)
			.is('parent_product_id', null)
			.neq('id', String(row.id))
			.order('created_at', { ascending: false })
			.limit(5);

		const popRows = (popRaw ?? []) as Array<{ id: string; name: string; slug: string | null; image_urls: string[]; base_price_daily: number }>;

		// base_price_daily=0인 상품은 price_rules 24H 룰로 폴백
		const popIds = popRows.map((p) => p.id);
		const pop24hMap: Record<string, number> = {};
		if (popIds.length > 0) {
			const { data: popRules } = await locals.supabase
				.from('price_rules')
				.select('product_id, price')
				.in('product_id', popIds)
				.eq('duration_type', '24h')
				.eq('is_active', true)
				.is('deleted_at', null);
			for (const r of (popRules ?? []) as Array<{ product_id: string; price: number }>) {
				pop24hMap[r.product_id] = Number(r.price);
			}
		}

		popularProducts = popRows.map((p) => {
			const legacy = p.base_price_daily ?? 0;
			return {
				id:       p.id,
				name:     p.name,
				slug:     p.slug,
				imageUrl: p.image_urls?.[0] ?? null,
				price24h: legacy > 0 ? legacy : (pop24hMap[p.id] ?? 0),
				category: row.category as string,
			};
		});
	}

	const wishedIds = await getWishedProductIds(locals.supabase, session?.user.id, [String(row.id), ...popularProducts.map((p) => p.id)]);

	// BUG-FIX(2026-08-10): 상품상세 상단(ProductHero)의 카테고리 라벨이 하드코딩 영문 맵
	// (CATEGORY_MAP)에 의존하고 있었음 — 백오피스(code_mapping_groups) 값으로 통일. RLS가
	// is_cms_user()라 일반 고객은 anon key로 못 읽으므로 이 조회에 한해 service_role 사용
	// (RLS 정책 자체는 무변경, /cms/products·`/products` 목록 페이지와 동일 패턴).
	// Stephen 확정: code_mapping_groups가 유일한 정본 — "그룹명"(name)이 곧 노출 라벨,
	// product_category_codes는 무관한 별개 코드체계라 관여시키지 않는다.
	let categoryLabel: string | null = null;
	if (row.category) {
		const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '');
		const { data: groupRow } = await admin
			.from('code_mapping_groups')
			.select('name')
			.eq('default_category', row.category as string)
			.eq('is_active', true)
			.maybeSingle();
		categoryLabel = (groupRow as { name?: string } | null)?.name ?? null;
	}

	// ProductHero 카테고리 메뉴 — /products "카테고리 설정"과 동일 정본 재사용(공유 헬퍼).
	// 상품상세 화면 자체는 이 상품의 category와 무관하게 항상 전체 메뉴를 보여준다(전체목록
	// 이동용 내비게이션이므로 /products의 카테고리 탭과 동일한 목록이어야 함).
	let categories: DisplayCategory[] = [];
	{
		const { data: pageSettingsRaw } = await locals.supabase.rpc('get_product_page_settings');
		const pageSettings = (pageSettingsRaw as unknown as Record<string, unknown>) ?? {};
		const catSettings = (pageSettings['product_page_categories'] as { items: CatSettingsItem[] }) ?? { items: [] };
		if (catSettings.items.length > 0) {
			const groups = await getCategoryGroups();
			categories = joinDisplayCategories(catSettings.items, groups);
		}
	}

	return {
		product: enriched,
		productId: String(row.id),
		optionLinks,
		session,
		reviews,
		depositAmount: enriched.deposit_amount,
		rentalPeriods,
		rentalMethods,
		shippingPolicy,
		shotlogs,
		popularProducts,
		wishedIds,
		isLoggedIn: !!session?.user.id,
		categoryLabel,
		categories,
	};
};
