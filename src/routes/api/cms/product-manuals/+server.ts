/**
 * /api/cms/product-manuals — 상품설명서(PDF) 업로드 서명 발급 · 등록 전 임시 파일 삭제
 * POST   body {content_type, size, product_id | temp_id}
 *          → 비공개 쓰기 허가(서명 URL 토큰)만 발급한다. 파일은 브라우저가 저장소로 직접 올린다
 *            (서버 본문 한도 약 4.5MB 때문에 PDF를 서버로 통과시키지 않는다).
 *          product_id = 이미 등록된 대표 상품, temp_id = 상품 등록 화면(아직 상품 id 없음)이 만든 임시 범위.
 * DELETE body {path}
 *          → 등록 전 임시(temp/) 파일만 삭제. 이미 상품에 저장된 파일은 저장(updateSection manuals) 때 서버가 정리한다.
 * 목록 저장(products.manual_files)은 이 API가 아니라 상품 등록 액션·updateSection 이 한다.
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import type { RequestHandler } from './$types'
import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { manualPathInUse } from '$lib/server/products/manualFileFinalize'
import {
  PRODUCT_MANUAL_BUCKET,
  MAX_PRODUCT_MANUALS,
  validateManualUpload,
  buildManualPath,
  isValidManualPath,
} from '$lib/utils/productManuals'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TEMP_ID_RE = /^[A-Za-z0-9_-]{6,64}$/

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json()
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증이 필요합니다.' }, { status: 401 })
  const denied = await requireAnyMenuAccessApi(locals, ['products.list', 'products.new'])
  if (denied) return denied
  if (!(await getCmsRoleForAction(locals))) return json({ error: '접근 권한이 없습니다.' }, { status: 403 })

  const body = await readBody(request)
  if (!body) return json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const contentType = typeof body.content_type === 'string' ? body.content_type : ''
  const size = typeof body.size === 'number' ? body.size : Number.NaN
  const check = validateManualUpload(contentType, size)
  if (!check.ok) return json({ error: check.error }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let scope: string
  if (typeof body.product_id === 'string' && body.product_id) {
    if (!UUID_RE.test(body.product_id)) return json({ error: '잘못된 상품 ID입니다.' }, { status: 400 })
    const { data: product } = await admin
      .from('products')
      .select('id, parent_product_id, manual_files')
      .eq('id', body.product_id)
      .maybeSingle()
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 })
    if ((product as { parent_product_id: string | null }).parent_product_id) {
      return json({ error: '재고 단위 상품은 대표 상품에서 수정하세요.' }, { status: 400 })
    }
    const current = (product as { manual_files: unknown }).manual_files
    if (Array.isArray(current) && current.length >= MAX_PRODUCT_MANUALS) {
      return json({ error: `상품설명서는 최대 ${MAX_PRODUCT_MANUALS}개까지 등록할 수 있어요.` }, { status: 400 })
    }
    scope = body.product_id
  } else if (typeof body.temp_id === 'string' && TEMP_ID_RE.test(body.temp_id)) {
    scope = `temp/${body.temp_id}`
  } else {
    return json({ error: '상품 또는 임시 등록 정보가 필요합니다.' }, { status: 400 })
  }

  const path = buildManualPath(scope)
  const { data, error } = await admin.storage.from(PRODUCT_MANUAL_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return json({ error: '업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })

  return json({ path: data.path ?? path, token: data.token })
}

export const DELETE: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증이 필요합니다.' }, { status: 401 })
  const denied = await requireAnyMenuAccessApi(locals, ['products.list', 'products.new'])
  if (denied) return denied
  if (!(await getCmsRoleForAction(locals))) return json({ error: '접근 권한이 없습니다.' }, { status: 403 })

  const body = await readBody(request)
  const path = body && typeof body.path === 'string' ? body.path : ''
  if (!isValidManualPath(path) || !path.startsWith('temp/')) {
    return json({ error: '삭제할 수 없는 경로입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  // 이미 상품에 연결된 파일은 이 경로로 지울 수 없다(등록 직후 이관에 실패해 temp 경로가 남은 상품 파일 보호). 확인이 안 되면 지우지 않는다.
  const inUse = await manualPathInUse(admin, path)
  if (inUse === null) return json({ error: '파일 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  if (inUse) return json({ error: '이미 상품에 등록된 파일은 여기서 삭제할 수 없어요.' }, { status: 409 })
  const { error } = await admin.storage.from(PRODUCT_MANUAL_BUCKET).remove([path])
  if (error) return json({ error: '파일 삭제에 실패했어요.' }, { status: 500 })
  return json({ ok: true })
}
