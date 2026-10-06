import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 1단계 1f — 메뉴권한 서버 집행 Stage 실계정 검증 (2026-10-05, 라이브 통합 테스트)
 * Stage DB(ezyvffjvuwmtuhpxdjrw)에 임시 파트너 계정을 만들고, 실제 cms_menu_permissions 행을 넣었다 지우며
 * 실제 가드(requireMenuAccess*)·실제 핸들러·푸시 수신자 필터가 설정대로 동작하는지 확인한다.
 * 기존 실계정(매니저·슈퍼관리자) 설정은 건드리지 않고, 만든 계정·설정은 afterAll에서 전부 정리한다.
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY } }))

import { requireMenuAccessApi, requireAnyMenuAccessApi, requireMenuAccessAction } from '$lib/server/requireMenuAccess'
import { filterAdminPushRecipientsByMenu } from '$lib/server/adminPushMenuFilter'
import { UPLOAD_MENU_KEYS } from '$lib/server/uploadMenuKeys'
import { GET as mobileSearchRank } from '../../routes/api/cms/mobile-search-rank/+server'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
let uid = ''

// 요청마다 새 locals(가드의 요청 단위 캐시가 요청 사이에 공유되지 않도록)
const reqLocals = () =>
  ({ supabase: admin, safeGetSession: async () => ({ session: { user: { id: uid } } }) }) as never
const status = (r: Response | null) => (r ? r.status : 200)

async function setOverride(menuKey: string, allowed: boolean) {
  const { error } = await admin.from('cms_menu_permissions').upsert({ user_id: uid, menu_key: menuKey, allowed }, { onConflict: 'user_id,menu_key' })
  if (error) throw new Error(`오버라이드 저장 실패: ${error.message}`)
}
async function clearOverrides() {
  await admin.from('cms_menu_permissions').delete().eq('user_id', uid)
}

beforeAll(async () => {
  // 안전장치: Stage DB가 아니면 계정을 만들지 않고 즉시 실패(Production 오접속 방지)
  if (!PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')) throw new Error('Stage DB(ezyvffjvuwmtuhpxdjrw)가 아니어서 실행을 중단합니다.')
  const email = `tdd-menu-live-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(12).toString('hex'), email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  uid = data.user.id
  const { error: upErr } = await admin.from('user_profiles').update({ cms_role: 'partner' }).eq('id', uid)
  if (upErr) throw new Error(`파트너 지정 실패: ${upErr.message}`)
  const { data: chk } = await admin.from('user_profiles').select('cms_role').eq('id', uid).maybeSingle()
  if ((chk as { cms_role: string } | null)?.cms_role !== 'partner') throw new Error('임시 파트너 계정 준비 실패')
}, 30000)

afterAll(async () => {
  if (!uid) return
  await clearOverrides()
  await admin.from('user_profiles').delete().eq('id', uid)
  await admin.auth.admin.deleteUser(uid)
}, 30000)

describe('Stage 실계정 — 임시 파트너 계정', () => {
  it('① 설정이 없으면 파트너 기본 허용 메뉴는 전부 통과(무회귀)', async () => {
    await clearOverrides()
    for (const k of ['consulting.chat', 'consulting.qna', 'rental.reservation', 'rental.history', 'products.list', 'products.new', 'customers.list']) {
      expect(status(await requireMenuAccessApi(reqLocals(), k)), k).toBe(200)
    }
  })

  it('② 한 메뉴만 OFF → 그 메뉴만 403, 나머지는 그대로 통과', async () => {
    await clearOverrides()
    await setOverride('consulting.chat', false)
    const denied = await requireMenuAccessApi(reqLocals(), 'consulting.chat')
    expect(status(denied)).toBe(403)
    expect(((await denied!.json()) as { error: string }).error).toContain('권한')
    expect(status(await requireMenuAccessApi(reqLocals(), 'rental.reservation'))).toBe(200)
    expect(status(await requireMenuAccessApi(reqLocals(), 'customers.list'))).toBe(200)
    // 액션 게이트도 동일하게 거부
    const act = await requireMenuAccessAction(reqLocals(), 'consulting.chat')
    expect(act?.status).toBe(403)
  })

  it('③ 공용 API(any-of): 한쪽만 OFF면 통과, 둘 다 OFF면 403', async () => {
    await clearOverrides()
    await setOverride('consulting.chat', false)
    expect(status(await requireAnyMenuAccessApi(reqLocals(), ['consulting.chat', 'customers.list']))).toBe(200)
    await setOverride('customers.list', false)
    expect(status(await requireAnyMenuAccessApi(reqLocals(), ['consulting.chat', 'customers.list']))).toBe(403)
  })

  it('④ allowed=true 오버라이드는 role이 막은 메뉴를 열어주지 않는다(좁히기 전용)', async () => {
    await clearOverrides()
    await setOverride('customers.membership', true)
    expect(status(await requireMenuAccessApi(reqLocals(), 'customers.membership'))).toBe(403)
  })

  it('⑤ 실제 핸들러: 예약대여현황 OFF면 모바일 검색 API가 403, ON(설정 삭제)이면 다시 통과', async () => {
    await clearOverrides()
    await setOverride('rental.reservation', false)
    const off = await mobileSearchRank({ url: new URL('http://localhost/api/cms/mobile-search-rank'), locals: reqLocals() } as never)
    expect((off as Response).status).toBe(403)
    await clearOverrides()
    const on = await mobileSearchRank({ url: new URL('http://localhost/api/cms/mobile-search-rank'), locals: reqLocals() } as never)
    expect((on as Response).status).toBe(200)
  })

  it('⑥ 관리자 푸시 수신자 필터: 상담 OFF 계정만 제외, 다른 이벤트는 그대로', async () => {
    await clearOverrides()
    const others = ['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2']
    expect(await filterAdminPushRecipientsByMenu(admin, 'new_session', [uid, ...others])).toEqual([uid, ...others])
    await setOverride('consulting.chat', false)
    expect(await filterAdminPushRecipientsByMenu(admin, 'new_session', [uid, ...others])).toEqual(others)
    expect(await filterAdminPushRecipientsByMenu(admin, 'urgent_chat_message', [uid, ...others])).toEqual(others)
    // 2-B: 결제완료는 예약대여현황 권한을 따름 — 상담만 OFF인 이 계정은 계속 수신
    expect(await filterAdminPushRecipientsByMenu(admin, 'payment_completed', [uid, ...others])).toEqual([uid, ...others])
    await setOverride('rental.reservation', false)
    expect(await filterAdminPushRecipientsByMenu(admin, 'payment_completed', [uid, ...others])).toEqual(others)
    await setOverride('customers.list', false)
    expect(await filterAdminPushRecipientsByMenu(admin, 'identity_review', [uid, ...others])).toEqual(others)
  })

  it('⑧ 업로드 any-of(2-C): 업로드 화면 메뉴가 전부 OFF여야 막히고, 하나라도 ON이면 통과', async () => {
    await clearOverrides()
    expect(status(await requireAnyMenuAccessApi(reqLocals(), UPLOAD_MENU_KEYS))).toBe(200)
    // 파트너 기본 허용 메뉴만 OFF 처리(나머지는 role이 이미 막음) → 전부 막힘
    for (const k of ['products.list', 'products.new', 'rental.reservation', 'rental.history', 'consulting.qna']) await setOverride(k, false)
    expect(status(await requireAnyMenuAccessApi(reqLocals(), UPLOAD_MENU_KEYS))).toBe(403)
    await setOverride('rental.history', true) // allowed=true는 role 허용 범위 안에서 OFF 상태를 되돌림(행 갱신)
    expect(status(await requireAnyMenuAccessApi(reqLocals(), UPLOAD_MENU_KEYS))).toBe(200)
  })

  it('⑦ 설정 원복 확인: 임시 계정의 오버라이드를 지우면 다시 전부 통과', async () => {
    await clearOverrides()
    const { data } = await admin.from('cms_menu_permissions').select('menu_key').eq('user_id', uid)
    expect(data ?? []).toHaveLength(0)
    expect(status(await requireMenuAccessApi(reqLocals(), 'consulting.chat'))).toBe(200)
  })
})
