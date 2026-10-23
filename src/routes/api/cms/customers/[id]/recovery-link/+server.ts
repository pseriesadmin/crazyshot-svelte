// POST /api/cms/customers/[id]/recovery-link
// CMS 고객상세패널 — 고객에게 직접 전달하는 "비밀번호 설정 링크" 발행 (2026-10-23)
// 배경: 기존 회원(레거시) 인증 직후 비밀번호를 정하지 못했거나 잊은 고객이 메일을 못 받는 경우, 운영자가 링크를 만들어 직접 전달한다.
//   · 링크는 생성만 한다 — 메일·문자는 발송하지 않는다(전달 방법·문구는 운영자가 정한다).
//   · 링크를 연 사람은 누구나 그 계정의 비밀번호를 정할 수 있다 → 권한·대상·기록을 엄격히 제한한다.
//   · 권한: 세션 + CMS 역할 manager 이상 + 고객목록 메뉴 권한(오버레이)
//   · 대상: 일반 고객 계정만. 관리자(CMS) 계정은 거부(계정 관리의 전용 복구 흐름 사용), 삭제·탈회 완전삭제·익명화 계정도 거부
//   · 감사: cms_admin_audit_log('password_recovery_issued') — 발행 사실만 기록, 링크·토큰은 기록하지 않는다.
//     ⛔ fail-closed(2026-10-23, sp5 SEC-002): 기록에 실패하면 링크를 돌려주지 않는다(계정 인수 권한은 기록 없이 발급하지 않는다)
//   · 남용 방어(sp5 SEC-001): 발급자별 시간당 10건·하루 30건, 같은 고객 5분 쿨다운(감사로그 집계) + 발행 즉시 관리자 푸시 알림
//   · 탈회 유예(requested) 고객은 거절(sp5 SEC-003) — 링크로 로그인하면 탈회가 자동 취소되기 때문
//   · 링크 형식: /auth/reset-password?token_hash=…&type=recovery — 다른 기기·메일/메신저 내장 브라우저에서 열어도 동작(재설정 화면이 verifyOtp로 세션 생성)
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { insertCmsAdminAuditLogStrict } from '$lib/server/cmsAdminAuditLog'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import { sendPushToAdmins } from '$lib/server/push'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 탈회 완전삭제 시 이메일이 이 도메인의 익명 값으로 바뀐다(service-operations.md §16 ④) */
const PURGED_EMAIL_DOMAIN = '@purged.crazyshot.kr'
const NO_STORE = { 'Cache-Control': 'no-store' }
/** 발급자별 한도(감사로그 집계) */
const LIMIT_PER_HOUR = 10
const LIMIT_PER_DAY = 30
/** 같은 고객에게 다시 발행할 수 있는 최소 간격 */
const TARGET_COOLDOWN_MS = 5 * 60 * 1000
const ACTION_TYPE = 'password_recovery_issued'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 2)}***@${domain}`
}

export const POST: RequestHandler = async ({ params, url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 401, headers: NO_STORE })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ ok: false, error: '권한 없음' }, { status: 403, headers: NO_STORE })
  // 계정별 메뉴 권한 오버레이 — 고객목록 메뉴가 OFF로 잠긴 관리자는 직접 호출해도 발행 불가
  const menuDenied = await requireMenuAccessApi(locals, 'customers.list')
  if (menuDenied) return menuDenied

  const userId = params.id
  if (!UUID_RE.test(userId)) return json({ ok: false, error: '잘못된 사용자 ID' }, { status: 400, headers: NO_STORE })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500, headers: NO_STORE })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('user_id, cms_role, withdrawal_status, deleted_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (profileError) {
    console.error('[cms/recovery-link] 프로필 조회 실패:', profileError.message)
    return json({ ok: false, error: '조회에 실패했습니다.' }, { status: 500, headers: NO_STORE })
  }
  if (!profile) return json({ ok: false, error: '사용자를 찾을 수 없습니다.' }, { status: 404, headers: NO_STORE })

  const row = profile as { cms_role: string | null; withdrawal_status: string | null; deleted_at: string | null }
  // 관리자 계정에 이 경로로 링크를 만들면 manager가 superadmin 계정을 탈취할 수 있다 — 계정 관리의 전용 복구 흐름만 허용
  if (row.cms_role) {
    return json({ ok: false, error: '관리자 계정은 이 화면에서 링크를 만들 수 없습니다. 관리자 계정 관리의 복구 링크를 이용해 주세요.' }, { status: 403, headers: NO_STORE })
  }
  if (row.deleted_at || row.withdrawal_status === 'purged') {
    return json({ ok: false, error: '삭제되었거나 탈회가 완료된 계정입니다.' }, { status: 409, headers: NO_STORE })
  }
  // 탈회 유예 중인 고객은 링크 로그인 즉시 탈회가 자동 취소·데이터가 복구된다(+layout.server.ts) — 고객 본인의 재로그인으로만 복구되게 둔다
  if (row.withdrawal_status === 'requested') {
    return json({ ok: false, error: '탈회를 신청한 계정이에요. 고객 본인이 다시 로그인하면 탈회가 취소됩니다.' }, { status: 409, headers: NO_STORE })
  }

  // 발행 빈도 제한 — 침해된 관리자 계정으로 많은 고객 링크를 한꺼번에 만드는 것을 막는다. 집계 조회가 실패하면 안전하게 거절한다(fail-closed)
  const now = Date.now()
  const { data: mine, error: mineErr } = await admin
    .from('cms_admin_audit_log')
    .select('created_at')
    .eq('user_id', session.user.id)
    .eq('action_type', ACTION_TYPE)
    .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(LIMIT_PER_DAY + 1)
  const { data: sameTarget, error: targetErr } = await admin
    .from('cms_admin_audit_log')
    .select('created_at')
    .eq('target_user_id', userId)
    .eq('action_type', ACTION_TYPE)
    .gte('created_at', new Date(now - TARGET_COOLDOWN_MS).toISOString())
    .limit(1)
  if (mineErr || targetErr) {
    console.error('[cms/recovery-link] 발행 이력 조회 실패')
    return json({ ok: false, error: '잠시 후 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE })
  }
  const mineRows = (mine ?? []) as { created_at: string }[]
  const hourAgo = now - 60 * 60 * 1000
  if (mineRows.length >= LIMIT_PER_DAY || mineRows.filter((r) => new Date(r.created_at).getTime() >= hourAgo).length >= LIMIT_PER_HOUR) {
    return json({ ok: false, error: '링크 발행 횟수가 한도를 넘었어요. 잠시 후 다시 시도해 주세요. (시간당 10건·하루 30건)' }, { status: 429, headers: NO_STORE })
  }
  if (((sameTarget ?? []) as unknown[]).length > 0) {
    return json({ ok: false, error: '이 고객에게는 방금 링크를 발행했어요. 5분 뒤에 다시 시도해 주세요.' }, { status: 429, headers: NO_STORE })
  }

  // 링크는 로그인 계정(auth)의 이메일 기준으로 만든다 — 프로필 이메일과 어긋나도 실제 로그인 계정에만 발급
  const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId)
  const email = authData?.user?.email ?? ''
  if (authError || !authData?.user) {
    return json({ ok: false, error: '로그인 계정을 찾을 수 없습니다.' }, { status: 404, headers: NO_STORE })
  }
  if (!email || email.toLowerCase().endsWith(PURGED_EMAIL_DOMAIN)) {
    return json({ ok: false, error: '이메일이 없거나 삭제 처리된 계정입니다.' }, { status: 409, headers: NO_STORE })
  }

  // generateLink는 링크만 만든다(메일 미발송)
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  const tokenHash = linkData?.properties?.hashed_token
  if (linkError || !tokenHash) {
    // 오류 상세·링크 값은 로그에 남기지 않는다(이메일 등 개인정보 방지)
    console.error('[cms/recovery-link] 링크 생성 실패:', linkError ? 'generateLink error' : 'token_hash 없음')
    return json({ ok: false, error: '링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE })
  }

  // 기록이 남아야만 링크를 돌려준다(fail-closed) — 기록 실패 시 방금 만든 링크는 폐기(응답하지 않음)
  const audited = await insertCmsAdminAuditLogStrict(admin, {
    actorId: session.user.id,
    actionType: 'password_recovery_issued',
    targetUserId: userId,
    afterValue: { kind: 'customer_recovery_link' },
  })
  if (!audited) {
    return json({ ok: false, error: '발행 기록을 남기지 못해 링크를 만들지 않았어요. 잠시 후 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE })
  }

  // 관리자 알림 — 탈취·오발행을 빨리 알아챌 수 있게(본인증명 승인 알림 수신 설정 관리자 대상).
  // 감사 기록은 이미 남았으므로 알림 구간의 어떤 실패도 발행 결과(링크 반환)에는 영향을 주지 않는다.
  try {
    const actor = await fetchCmsProfileByAuthId(admin, session.user.id)
    await sendPushToAdmins('identity_review', {
      title: '고객 비밀번호 설정 링크가 발행됐어요',
      body: `${actor?.name ?? '관리자'}님이 고객 계정(${maskEmail(email)})의 링크를 발행했어요.`,
      link: `/cms/customers?selected=${userId}`,
    })
  } catch {
    console.error('[cms/recovery-link] 관리자 알림 실패(발행은 유지)')
  }

  const link = `${url.origin}/auth/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
  return json({ ok: true, link }, { headers: NO_STORE })
}
