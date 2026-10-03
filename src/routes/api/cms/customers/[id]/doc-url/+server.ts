// GET /api/cms/customers/[id]/doc-url?type=identity|foreign&index=N[&download=파일명]
// CMS 고객상세패널의 서류 "보기/다운로드" — 클릭 시점에 짧은 만료(60초) 서명 URL을 발급한다(2026-10-03, 서류 비공개 전환 B1).
// 서류를 공개 URL로 DB에 저장하던 구조(인증 없이 URL만으로 영구 열람)를 대체하는 유일한 열람 경로다.
//   · 권한: 세션 + CMS 역할 manager 이상(hasSettingsAccess) — 신분증 열람은 쓰기 게이트와 같은 수준(security-auth.md)
//   · 열람 감사: cms_admin_audit_log('doc_view', fail-soft) + 서버 로그 1줄
//   · 대상 파일은 클라이언트가 보낸 경로가 아니라 (고객, 종류, 순번)으로 서버가 DB에서 직접 결정 — 임의 경로 서명 불가
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import { docExtension, signDocPath, toDocPath } from '$lib/server/userDocs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_INDEX = 8
const SIGN_EXPIRES_SEC = 60

// 다운로드 파일명은 영숫자·점·밑줄·하이픈만(헤더 주입·경로 문자 방지)
function sanitizeFileBase(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  return cleaned || null
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ ok: false, error: '권한 없음' }, { status: 403 })
  // 계정별 메뉴 권한 오버레이 — 고객목록 메뉴가 OFF로 잠긴 관리자는 직접 호출해도 열람 불가
  const menuDenied = await requireMenuAccessApi(locals, 'customers.list')
  if (menuDenied) return menuDenied

  const userId = params.id
  if (!UUID_RE.test(userId)) return json({ ok: false, error: '잘못된 사용자 ID' }, { status: 400 })

  const type = url.searchParams.get('type')
  if (type !== 'identity' && type !== 'foreign') return json({ ok: false, error: '잘못된 문서 유형' }, { status: 400 })

  const index = Number(url.searchParams.get('index'))
  if (!Number.isInteger(index) || index < 0 || index > MAX_INDEX) {
    return json({ ok: false, error: '잘못된 파일 순번' }, { status: 400 })
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('identity_doc_url, foreign_doc_url, foreign_doc_urls')
    .eq('user_id', userId)
    .maybeSingle()
  if (profileError) {
    console.error('[cms/doc-url] 프로필 조회 실패:', profileError.message)
    return json({ ok: false, error: '조회에 실패했습니다.' }, { status: 500 })
  }
  if (!profile) return json({ ok: false, error: '사용자를 찾을 수 없습니다.' }, { status: 404 })

  const row = profile as { identity_doc_url: string[] | null; foreign_doc_url: string | null; foreign_doc_urls: string[] | null }
  // CustomerDetailPanel.foreignDocList와 동일 규칙: foreign_doc_urls가 비어 있으면 레거시 스칼라 1개를 사용
  const list: string[] =
    type === 'identity'
      ? (row.identity_doc_url ?? [])
      : row.foreign_doc_urls && row.foreign_doc_urls.length > 0
        ? row.foreign_doc_urls
        : row.foreign_doc_url
          ? [row.foreign_doc_url]
          : []

  const path = toDocPath(list[index], userId)
  if (!path) return json({ ok: false, error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  const base = sanitizeFileBase(url.searchParams.get('download'))
  const ext = docExtension(path)
  const signed = await signDocPath(admin, path, {
    expiresIn: SIGN_EXPIRES_SEC,
    download: base ? `${base}${ext ? `.${ext}` : ''}` : undefined,
  })
  if (!signed) return json({ ok: false, error: '파일을 열 수 없습니다.' }, { status: 500 })

  console.info(`[cms/doc-url] ${cmsRole} ${session.user.id} → ${type}[${index}] of ${userId}${base ? ' (download)' : ''}`)
  await insertCmsAdminAuditLog(admin, {
    actorId: session.user.id,
    actionType: 'doc_view',
    targetUserId: userId,
    afterValue: { doc_type: type, index, download: !!base },
  })

  // 서명 URL은 캐시되면 안 된다(60초 만료 + 열람 감사 의미 유지)
  return json(
    { ok: true, url: signed.url, isPdf: signed.isPdf, expiresIn: signed.expiresIn },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
