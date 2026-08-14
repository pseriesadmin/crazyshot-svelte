/**
 * /cms/set/signature — 관리자 서명/직인 자산 등록 화면 서버
 * Phase 8-B-2 | manager 이상 게이트 (security-auth.md P8B-2)
 */
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { validateUploadFile } from '$lib/utils/fileValidation'

export interface SignatureAsset {
  id: string
  admin_id: string
  asset_type: 'signature' | 'seal'
  image_url: string
  label: string | null
  is_default: boolean
  created_at: string
}

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole, session } = await parent()
  // P8B-2: manager 이상만 진입 허용
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')
  if (!session) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: assets } = await (admin as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          is: (k: string, v: null) => {
            order: (k: string, o: { ascending: boolean }) => Promise<{ data: SignatureAsset[] | null }>
          }
        }
      }
    }
  }).from('cms_signature_assets')
    .select('id, admin_id, asset_type, image_url, label, is_default, created_at')
    .eq('admin_id', session.user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return {
    assets: (assets ?? []) as SignatureAsset[],
  }
}

export const actions: Actions = {
  // 서명/직인 자산 등록
  uploadAsset: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const form      = await request.formData()
    const assetType = form.get('asset_type') as string | null
    const label     = (form.get('label') as string | null)?.trim() ?? null
    const file      = form.get('file') as File | null

    if (!assetType || !['signature', 'seal'].includes(assetType)) {
      return fail(400, { error: '자산 유형을 선택해주세요.' })
    }
    if (!file || file.size === 0) return fail(400, { error: '파일을 선택해주세요.' })

    // 클라이언트 MIME 검증 (uiux-index.md 표준 패턴)
    const validation = validateUploadFile(file)
    if (!validation.ok) return fail(400, { error: validation.error })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Supabase Storage 업로드 (product-images 버킷 signature-assets/ 경로)
    const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    const path     = `signature-assets/${session.user.id}/${crypto.randomUUID()}.${ext}`
    const buf      = await file.arrayBuffer()
    const { error: uploadErr } = await admin.storage
      .from('product-images')
      .upload(path, buf, { contentType: file.type, upsert: false })

    if (uploadErr) return fail(500, { error: `파일 업로드 실패: ${uploadErr.message}` })

    const imageUrl = admin.storage.from('product-images').getPublicUrl(path).data.publicUrl

    const { error: insertErr } = await (admin as unknown as {
      from: (t: string) => {
        insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
      }
    }).from('cms_signature_assets').insert({
      admin_id:   session.user.id,
      asset_type: assetType,
      image_url:  imageUrl,
      label,
      is_default: false,
    })

    if (insertErr) return fail(500, { error: `자산 등록 실패: ${insertErr.message}` })
    return { success: true }
  },

  // 기본값 지정
  setDefault: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const form      = await request.formData()
    const assetId   = form.get('asset_id') as string | null
    const assetType = form.get('asset_type') as string | null
    if (!assetId || !assetType) return fail(400, { error: '필수 파라미터 누락' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 동일 유형의 기존 기본값 해제 후 신규 지정
    type AdminFrom = {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (k: string, v: string) => {
            neq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
            eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
          }
        }
      }
    }
    const adminTyped = admin as unknown as AdminFrom

    await adminTyped.from('cms_signature_assets').update({ is_default: false })
      .eq('admin_id', session.user.id)
      .eq('asset_type', assetType)
    await adminTyped.from('cms_signature_assets').update({ is_default: true })
      .eq('admin_id', session.user.id)
      .eq('id', assetId)

    return { success: true }
  },

  // 소프트 삭제
  deleteAsset: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const form    = await request.formData()
    const assetId = form.get('asset_id') as string | null
    if (!assetId) return fail(400, { error: '자산 ID 필요' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error: deleteErr } = await (admin as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
          }
        }
      }
    }).from('cms_signature_assets').update({ deleted_at: new Date().toISOString() })
      .eq('id', assetId)
      .eq('admin_id', session.user.id)  // 자신의 자산만 삭제 가능

    if (deleteErr) return fail(500, { error: `삭제 실패: ${deleteErr.message}` })
    return { success: true }
  },
}
