import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * approve_customer_doc RPC 가드 — TDD (Migration #526)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 완료기준(B-START):
 *   정상동작: identity_verified_at 있는 상태에서 approve_customer_doc('identity') 호출 시
 *             identity_approved_at이 설정되고 {ok:true}를 반환한다.
 *   막아야할것: 제출 이력(verified_at) 없이 승인 시도하면 {ok:false}를 반환하고
 *              approved_at은 여전히 NULL이어야 한다. identity 승인이 foreign_approved_at에
 *              영향을 주면 안 된다(독립).
 *
 * 주의: Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합 테스트.
 * Migration #526 적용 전까지 이 테스트 전체는 RED(RPC 자체가 없어 PGRST202 등으로 실패)다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let testUserId: string

beforeAll(async () => {
  const email = `tdd-approve-doc-rpc-${Date.now()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
  })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  testUserId = data.user.id
})

afterAll(async () => {
  if (testUserId) await admin.auth.admin.deleteUser(testUserId)
})

describe('approve_customer_doc — 제출 이력 없이 승인 시도 시 실패', () => {
  it('identity_verified_at NULL 상태에서 승인 시도 → {ok:false}, approved_at 여전히 NULL', async () => {
    const { data } = await admin.rpc('approve_customer_doc', {
      p_user_id: testUserId,
      p_doc_type: 'identity',
    })
    const result = data as { ok: boolean; error?: string } | null
    expect(result?.ok).toBe(false)

    const { data: profile } = await admin
      .from('user_profiles')
      .select('identity_approved_at')
      .eq('id', testUserId)
      .single()
    expect((profile as { identity_approved_at: string | null }).identity_approved_at).toBeNull()
  })
})

describe('approve_customer_doc — 제출된 문서 승인 성공', () => {
  it('identity_verified_at 있는 상태에서 승인 → {ok:true}, identity_approved_at 설정됨', async () => {
    const submittedAt = new Date().toISOString()
    await admin
      .from('user_profiles')
      .update({ identity_doc_url: ['https://example.com/doc.png'], identity_verified_at: submittedAt })
      .eq('id', testUserId)

    const { data } = await admin.rpc('approve_customer_doc', {
      p_user_id: testUserId,
      p_doc_type: 'identity',
    })
    const result = data as { ok: boolean; approved_at?: string } | null
    expect(result?.ok).toBe(true)
    expect(result?.approved_at).toBeTruthy()

    const { data: profile } = await admin
      .from('user_profiles')
      .select('identity_approved_at, foreign_approved_at')
      .eq('id', testUserId)
      .single()
    const p = profile as { identity_approved_at: string | null; foreign_approved_at: string | null }
    expect(p.identity_approved_at).not.toBeNull()
    // 본인증명 승인이 외국인증명 승인 상태에 영향을 주면 안 된다(독립, Decision B)
    expect(p.foreign_approved_at).toBeNull()
  })

  it('승인 이후 재제출되면(verified_at이 approved_at보다 최신) "검토 대기" 상태로 판정 가능해야 한다', async () => {
    const { data: before } = await admin
      .from('user_profiles')
      .select('identity_approved_at')
      .eq('id', testUserId)
      .single()
    const approvedAt = (before as { identity_approved_at: string }).identity_approved_at

    // 승인 이후 재제출 시뮬레이션 — verified_at을 approved_at보다 1초 뒤로 갱신
    const resubmittedAt = new Date(new Date(approvedAt).getTime() + 1000).toISOString()
    await admin.from('user_profiles').update({ identity_verified_at: resubmittedAt }).eq('id', testUserId)

    const { data: after } = await admin
      .from('user_profiles')
      .select('identity_verified_at, identity_approved_at')
      .eq('id', testUserId)
      .single()
    const a = after as { identity_verified_at: string; identity_approved_at: string }
    // CustomerDetailPanel.svelte의 needsDocApproval() 판정식과 동일한 비교
    expect(new Date(a.identity_approved_at) < new Date(a.identity_verified_at)).toBe(true)
  })
})
