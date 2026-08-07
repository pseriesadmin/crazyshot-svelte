import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'

// 순수 상품 이력관리 전용 화면 — /cms/products의 상세 편집 기능(옵션·가격·대여정책 등)은
// 노출하지 않는다. '이력' 탭에 등록한 기록은 /api/cms/product-history를 그대로 공유하므로
// /cms/products 상세 패널의 '이력' 탭에서도 동일하게 조회된다.
export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const q = url.searchParams.get('q') ?? ''
  const selectedId = url.searchParams.get('selected') ?? null

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  // 카테고리 레이블 맵 (카드 배지·패널 헤더 표시용, depth=0 기준)
  const { data: rawCatCodes } = await admin
    .from('product_category_codes')
    .select('product_category, name')
    .eq('depth', 0)
    .eq('is_active', true)
    .is('deleted_at', null)

  const categoryLabels: Record<string, string> = Object.fromEntries(
    (rawCatCodes ?? [])
      .filter((c) => c.product_category)
      .map((c) => [c.product_category as string, c.name as string])
  )

  // 상품 목록 — 대표(부모) 상품만 노출 (products.md: 부모+자식 혼합 조회 금지)
  let listQ = admin
    .from('products')
    .select('id, name, product_code, category, image_urls, is_active')
    .is('deleted_at', null)
    .is('parent_product_id', null)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(200)
  if (q) listQ = listQ.ilike('name', `%${q}%`)

  const { data: products } = await listQ

  // 선택된 상품(대표 또는 재고 단위 자식) 상세 — ProductDetailPanel(tabs=['history'])에 그대로 전달
  // 필드 구성은 ProductDetailPanel.svelte의 ProductDetail 인터페이스와 동일하게 맞춤
  type SelectedProduct = {
    id: string
    category: string
    name: string
    slug: string
    product_code: string | null
    brand: string | null
    description: string | null
    product_caption: string | null
    image_urls: string[]
    parent_product_id: string | null
    specifications: Record<string, string> | null
    is_active: boolean
    created_at: string
    qr_payload: string | null
    sale_price: number | null
    sale_only: boolean
    assetCount: number
    price12h: number | null
    price24h: number | null
  }
  let selectedProduct: SelectedProduct | null = null
  let selectedPriceRules: Array<{
    duration_type: string
    price: number
    deposit_amount: number | null
    late_fee_per_hour: number | null
    damage_fee_percentage: number | null
  }> = []
  type InventoryUnit = {
    id: string
    name: string
    product_code: string | null
    is_active: boolean
    price_rules: Array<{ duration_type: string; price: number }>
  }
  let inventoryList: InventoryUnit[] = []
  let rootProduct: { id: string; name: string; category: string; image_urls: string[]; product_code: string | null } | null = null

  if (selectedId) {
    const { data: sp } = await admin
      .from('products')
      .select('*')
      .eq('id', selectedId)
      .is('deleted_at', null)
      .single()

    if (sp) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spAny = sp as any
      const parentProductId = spAny.parent_product_id as string | null
      const rootId = parentProductId ?? selectedId
      // 이름·이미지·카테고리 표시는 대표(부모) 기준 통일 — products.md §9 정책과 동일
      const policySourceId = parentProductId ?? selectedId

      const [policyRes, priceRulesRes, assetCountRes, invRes] = await Promise.all([
        parentProductId
          ? admin.from('products').select('name, brand, category, product_caption, image_urls, product_code').eq('id', rootId).single()
          : Promise.resolve({ data: null }),
        admin
          .from('price_rules')
          .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
          .eq('product_id', policySourceId)
          .eq('is_active', true)
          .is('deleted_at', null),
        admin.from('products').select('id', { count: 'exact', head: true }).eq('parent_product_id', rootId).eq('is_active', true).is('deleted_at', null),
        admin
          .from('products')
          .select('id, name, product_code, is_active, price_rules!left(duration_type, price, is_active, deleted_at)')
          .eq('parent_product_id', rootId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const src = (policyRes.data ?? spAny) as any
      selectedPriceRules = priceRulesRes.data ?? []

      selectedProduct = {
        ...spAny,
        name: src.name ?? spAny.name,
        brand: src.brand ?? null,
        category: src.category ?? spAny.category,
        product_caption: src.product_caption ?? null,
        image_urls: src.image_urls ?? spAny.image_urls ?? [],
        assetCount: assetCountRes.count ?? 0,
        price12h: selectedPriceRules.find((r) => r.duration_type === '12h')?.price ?? null,
        price24h: selectedPriceRules.find((r) => r.duration_type === '24h')?.price ?? null,
      }

      inventoryList = (invRes.data ?? []).map((p) => {
        const row = p as Record<string, unknown>
        return {
          id: row.id as string,
          name: row.name as string,
          product_code: row.product_code as string | null,
          is_active: row.is_active as boolean,
          price_rules: ((row.price_rules as Array<{ duration_type: string; price: number; is_active: boolean; deleted_at: string | null }>) ?? [])
            .filter((r) => r.is_active && !r.deleted_at)
            .map((r) => ({ duration_type: r.duration_type, price: r.price })),
        }
      })

      if (parentProductId) {
        const pr = policyRes.data as Record<string, unknown> | null
        if (pr) {
          rootProduct = {
            id: rootId,
            name: pr.name as string,
            category: pr.category as string,
            image_urls: (pr.image_urls as string[]) ?? [],
            product_code: pr.product_code as string | null,
          }
        }
      } else {
        // selectedProduct는 위에서 sp 기반으로 이미 할당됨 (if (sp) 블록 내부)
        rootProduct = {
          id: selectedProduct!.id,
          name: selectedProduct!.name,
          category: selectedProduct!.category,
          image_urls: selectedProduct!.image_urls ?? [],
          product_code: selectedProduct!.product_code,
        }
      }
    }
  }

  return {
    products: (products ?? []) as Array<{
      id: string
      name: string
      product_code: string | null
      category: string
      image_urls: string[]
      is_active: boolean
    }>,
    q,
    selectedId,
    selectedProduct,
    selectedPriceRules,
    inventoryList,
    rootProduct,
    categoryLabels,
  }
}
