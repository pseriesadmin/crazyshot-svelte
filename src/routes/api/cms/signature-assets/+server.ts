/**
 * GET  /api/cms/signature-assets — 현재 관리자의 서명/직인 자산 목록 반환
 * POST /api/cms/signature-assets — 서명/직인 자산 등록 (gif 지원, 로컬 MIME 검증 전용)
 *
 * ⚠️ gif 허용은 이 라우트 전용 로컬 검증으로만 처리.
 *    전역 validateUploadFile()은 절대 사용 금지 (gif 미허용 + fileValidation.ts 수정 금지).
 *
 * Phase 8-B-3: SealAssetPicker.svelte / ContractTemplatePanel.svelte에서 호출
 */
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

/** 이 라우트 전용 허용 MIME (gif 포함 — 전역 UPLOAD_ACCEPTED_TYPES와 별개) */
const LOCAL_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif'] as const
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

export const GET: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json([], { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: assets } = await (admin as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          is: (k: string, v: null) => {
            order: (k: string, o: { ascending: boolean }) => Promise<{ data: unknown[] | null }>
          }
        }
      }
    }
  }).from('cms_signature_assets')
    .select('id, asset_type, image_url, label, is_default')
    .eq('admin_id', session.user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return json(assets ?? [])
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음 (manager 이상)' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: '요청 파싱 실패' }, { status: 400 })
  }

  const assetType = form.get('asset_type') as string | null
  const label     = (form.get('label') as string | null)?.trim() ?? null
  const file      = form.get('file') as File | null

  if (!assetType || !['signature', 'seal'].includes(assetType)) {
    return json({ error: '자산 유형을 선택해주세요. (signature 또는 seal)' }, { status: 400 })
  }
  if (!file || file.size === 0) {
    return json({ error: '파일을 선택해주세요.' }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return json({ error: '파일 크기는 5MB 이하여야 합니다.' }, { status: 400 })
  }

  // 로컬 MIME 검증 (gif 허용 — 전역 validateUploadFile() 사용 금지)
  if (!(LOCAL_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return json({ error: 'PNG, JPEG, GIF 파일만 업로드할 수 있습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const path = `signature-assets/${session.user.id}/${crypto.randomUUID()}.${ext}`
  const buf  = await file.arrayBuffer()

  const { error: uploadErr } = await admin.storage
    .from('product-images')
    .upload(path, buf, { contentType: file.type, upsert: false })

  if (uploadErr) {
    return json({ error: `파일 업로드 실패: ${uploadErr.message}` }, { status: 500 })
  }

  const imageUrl = admin.storage.from('product-images').getPublicUrl(path).data.publicUrl

  const { data: inserted, error: insertErr } = await (admin as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (s: string) => Promise<{ data: { id: string; image_url: string }[] | null; error: { message: string } | null }>
      }
    }
  }).from('cms_signature_assets')
    .insert({
      admin_id:   session.user.id,
      asset_type: assetType,
      image_url:  imageUrl,
      label,
      is_default: false,
    })
    .select('id, image_url')

  if (insertErr) {
    return json({ error: `자산 등록 실패: ${insertErr.message}` }, { status: 500 })
  }

  const created = inserted?.[0]
  return json({ id: created?.id, image_url: created?.image_url ?? imageUrl }, { status: 201 })
}
