/**
 * POST /api/cms/contracts/[id]/issuer-sign
 * 발행자(관리자) 서명·직인을 계약서에 등록
 * Phase 8-B-3 | manager 이상 게이트
 *
 * body:
 *   signature_type: 'personal_signature' | 'company_seal'
 *   asset_id?:        cms_signature_assets.id (자산 선택 시)
 *   signature_data?:  base64 PNG string (직접 서명 시)
 */
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { computeContentHash } from '$lib/contract-signature/contentHash'
import { recordAuditLog } from '$lib/contract-signature/auditLog'

export const POST: RequestHandler = async ({ params, locals, request, getClientAddress }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const contractId = params.id
  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let body: {
    signature_type?: string
    asset_id?: string | null
    signature_data?: string | null
  }
  try {
    body = await request.json() as typeof body
  } catch {
    return json({ error: '잘못된 요청 형식' }, { status: 400 })
  }

  const { signature_type, asset_id, signature_data } = body
  if (!signature_type || !['personal_signature', 'company_seal'].includes(signature_type)) {
    return json({ error: 'signature_type 필수 (personal_signature|company_seal)' }, { status: 400 })
  }
  if (!asset_id && !signature_data) {
    return json({ error: '자산 선택(asset_id) 또는 직접 서명(signature_data) 중 하나는 필수' }, { status: 400 })
  }

  // 계약서 콘텐츠 조회 → content_hash 계산
  const { data: contract } = await admin
    .from('contracts')
    .select('content_blocks, canvas_document')
    .eq('id', contractId)
    .maybeSingle()

  let contentHash: string | null = null
  if (contract) {
    const hashTarget = (contract as Record<string, unknown>).canvas_document
      ?? (contract as Record<string, unknown>).content_blocks
    contentHash = await computeContentHash(hashTarget)
  }

  // 자산 선택 시 image_url 조회
  let imageUrl: string | null = null
  if (asset_id) {
    const { data: asset } = await (admin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{ data: { image_url: string } | null }>
          }
        }
      }
    }).from('cms_signature_assets')
      .select('image_url')
      .eq('id', asset_id)
      .maybeSingle()
    imageUrl = asset?.image_url ?? null
  }

  // contract_issuer_signatures 저장
  const { error: insertErr } = await (admin as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    }
  }).from('contract_issuer_signatures').insert({
    contract_id:          contractId,
    admin_id:             session.user.id,
    signature_type,
    signature_image_url:  imageUrl ?? null,
    signature_data:       signature_data ?? null,
    asset_id:             asset_id ?? null,
    content_hash:         contentHash,
    signed_at:            new Date().toISOString(),
    ip_address:           getClientAddress(),
  })

  if (insertErr) {
    return json({ error: insertErr.message }, { status: 500 })
  }

  // P8A-3: issuer_signed 감사로그
  await recordAuditLog(admin as Parameters<typeof recordAuditLog>[0], {
    contractId,
    eventType:  'issuer_signed',
    actorType:  'admin',
    actorId:    session.user.id,
    ipAddress:  getClientAddress(),
  })

  return json({ ok: true })
}
