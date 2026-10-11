import { describe, it, expect, vi } from 'vitest'

/**
 * 푸시알림 설정 화면이 보여주는 "현재 발송 문구"가 실제 발송 코드와 어긋나지 않는지 고정한다 (2026-10-12).
 *  - 화면의 기본 문구(NOTIFY_SPECS.defaultMessage) = push.ts 푸시 고정 문구
 *  - 화면의 문자 현재 문구(load.smsDefaults) = sms.ts 고정 문구 + 링크 첨부 규칙
 * 고정 문구를 바꾸면서 화면 쪽을 놓치면 이 테스트가 깨진다.
 */
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$app/environment', () => ({ dev: false }))
vi.mock('solapi', () => ({ SolapiMessageService: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ cert: vi.fn(), getApps: () => [], initializeApp: vi.fn() }))
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({}) }))
vi.mock('$lib/server/crazychat/action', () => ({ AGENT_REQUEST_KIND_LABEL: {} }))
vi.mock('$lib/server/adminPushMenuFilter', () => ({ filterAdminPushRecipientsByMenu: async () => [] }))
vi.mock('@sveltejs/kit', () => ({ fail: (s: number, d?: unknown) => ({ status: s, data: d }), redirect: () => { throw new Error('redirect') } }))

const emptyChain = () => {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'order', 'in', 'range']) c[m] = () => c
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(res)
  return c
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => emptyChain(), rpc: async () => ({ data: null, error: null }) }) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/requireTrueSuperadmin', () => ({ requireAccountMutationAccess: async () => null }))
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLog: async () => {} }))

import { CUSTOMER_LIFECYCLE_PUSH_COPY } from '$lib/server/push'
import { NOTIFY_SPECS, getNotifySpec } from '$lib/utils/notifyTemplate'
import { load } from '../../routes/cms/set/push/+page.server'

describe('화면의 푸시 기본 문구 = push.ts 고정 문구', () => {
  for (const [type, copy] of Object.entries(CUSTOMER_LIFECYCLE_PUSH_COPY)) {
    const spec = getNotifySpec(type)
    if (!spec || type === 'locker_guide') continue // 무인보관함은 공통 안내문장 별도 조립(lockerGuideMessage)
    it(`${type}`, () => {
      expect(copy.body('{{상품명}}')).toBe(spec.defaultMessage)
    })
  }
})

describe('화면의 문자 현재 문구 = sms.ts 고정 문구', () => {
  it('문자 대상(무인보관함 제외)은 모두 현재 문구가 내려오고, [크레이지샷]으로 시작하며 링크가 붙는다', async () => {
    const res = (await (load as unknown as (e: unknown) => Promise<{ smsDefaults: Record<string, string> }>)({
      parent: async () => ({ cmsRole: 'manager' }),
      url: new URL('https://x.test/cms/set/push'),
    }))
    const smsTypes = NOTIFY_SPECS.filter((s) => s.sms && s.notifyType !== 'locker_guide').map((s) => s.notifyType)
    expect(smsTypes.length).toBe(9)
    for (const t of smsTypes) {
      expect(res.smsDefaults[t], t).toBeTruthy()
      expect(res.smsDefaults[t].startsWith('[크레이지샷] ')).toBe(true)
      expect(res.smsDefaults[t]).toContain('http')
    }
    expect(res.smsDefaults.contract_sent).toContain('전자계약서가 도착했어요')
    expect(res.smsDefaults.contract_signed_customer).toContain('서명이 완료됐어요')
  })
})
