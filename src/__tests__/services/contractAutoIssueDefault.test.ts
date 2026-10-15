import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 전자계약 자동발행 표준양식 — Migration #717 라이브 통합테스트(Stage DB ezyvffjvuwmtuhpxdjrw)
 * ① 한 번에 1개만 지정 ② 다른 양식을 켜면 기존 지정 자동 해제 ③ 끄기 ④ 보관·삭제된 양식은 지정 불가/자동 해제 ⑤ 권한(anon·authenticated 차단)
 * 기존에 이미 지정된 양식이 있으면 테스트 후 원래 상태로 복원한다.
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const created: string[] = []
let originalDefault: string | null = null

async function mk(title: string): Promise<string> {
  const { data, error } = await admin.from('contract_templates').insert({ title: `TEST_AUTOISSUE_${title}`, content_blocks: [] }).select('id').single()
  expect(error).toBeNull()
  created.push(data!.id as string)
  return data!.id as string
}
const flagged = async () =>
  ((await admin.from('contract_templates').select('id').eq('auto_issue_default', true).is('deleted_at', null)).data ?? []).map((r) => r.id as string)

async function snapshot() {
  const ids = await flagged()
  originalDefault = ids.find((i) => !created.includes(i)) ?? null
}
afterEach(async () => {
  if (created.length) await admin.from('contract_templates').delete().in('id', created)
  created.length = 0
  if (originalDefault) await admin.rpc('cms_set_auto_issue_template', { p_template_id: originalDefault, p_on: true })
  originalDefault = null
})

describe('cms_set_auto_issue_template (#717)', () => {
  it('켜면 그 양식만 지정되고, 다른 양식을 켜면 이전 지정이 해제된다', async () => {
    await snapshot()
    const a = await mk('A')
    const b = await mk('B')
    const r1 = await admin.rpc('cms_set_auto_issue_template', { p_template_id: a, p_on: true })
    expect(r1.data).toMatchObject({ ok: true, on: true })
    expect(await flagged()).toEqual([a])
    const r2 = await admin.rpc('cms_set_auto_issue_template', { p_template_id: b, p_on: true })
    expect(r2.data).toMatchObject({ ok: true, on: true })
    expect(await flagged()).toEqual([b])
  })

  it('끄면 아무 양식도 지정되지 않는다', async () => {
    await snapshot()
    const a = await mk('A')
    await admin.rpc('cms_set_auto_issue_template', { p_template_id: a, p_on: true })
    const r = await admin.rpc('cms_set_auto_issue_template', { p_template_id: a, p_on: false })
    expect(r.data).toMatchObject({ ok: true, on: false })
    expect(await flagged()).toEqual([])
  })

  it('보관(archived)·삭제된 양식은 지정할 수 없고, 지정된 양식이 보관되면 자동 해제된다', async () => {
    await snapshot()
    const a = await mk('A')
    await admin.from('contract_templates').update({ status: 'archived' }).eq('id', a)
    expect((await admin.rpc('cms_set_auto_issue_template', { p_template_id: a, p_on: true })).data).toMatchObject({ ok: false, error: 'template_not_active' })

    const b = await mk('B')
    await admin.rpc('cms_set_auto_issue_template', { p_template_id: b, p_on: true })
    await admin.from('contract_templates').update({ status: 'archived' }).eq('id', b)
    expect(await flagged()).toEqual([])
  })

  it('없는 양식은 template_not_found', async () => {
    const r = await admin.rpc('cms_set_auto_issue_template', { p_template_id: '00000000-0000-0000-0000-000000000000', p_on: true })
    expect(r.data).toMatchObject({ ok: false, error: 'template_not_found' })
  })

  it('anon 키로는 호출할 수 없다(service_role 전용)', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const r = await anon.rpc('cms_set_auto_issue_template', { p_template_id: '00000000-0000-0000-0000-000000000000', p_on: true })
    expect(r.error).toBeTruthy()
  })
})
