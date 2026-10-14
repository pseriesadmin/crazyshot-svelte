import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 고객목록 검색 — Stage DB 라이브 테스트 (Migration #705)
 *
 * 완료기준:
 *   정상동작: 회원코드(대소문자 무관)로 검색되고, 전화번호는 하이픈 포함·미포함 입력 모두 저장 형식과 무관하게 검색된다.
 *   막아야할것: 이메일 아이디처럼 영문이 섞인 입력의 숫자 조각이 다른 회원 전화번호에 우연히 맞아 엉뚱한 결과가 나오지 않는다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function search(q: string) {
  const { data, error } = await admin.rpc('get_customer_list', { p_search: q, p_limit: 50 })
  expect(error).toBeNull()
  return (data ?? []) as Array<{ user_id: string; member_code: string | null; phone: string | null; email: string }>
}

describe('get_customer_list 검색 확장 (#705)', () => {
  it('회원코드로 검색(대소문자 무관)', async () => {
    const { data } = await admin.from('user_profiles').select('member_code').is('deleted_at', null).not('member_code', 'is', null).limit(1).single()
    const code = (data as { member_code: string }).member_code
    expect((await search(code)).some((r) => r.member_code === code)).toBe(true)
    expect((await search(code.toLowerCase())).some((r) => r.member_code === code)).toBe(true)
  })

  it('전화번호 — 숫자만 저장된 회원도 하이픈 포함 입력으로 찾는다', async () => {
    const { data } = await admin.from('user_profiles').select('id, phone').is('deleted_at', null).like('phone', '010%').not('phone', 'like', '%-%').limit(1).single()
    const row = data as { id: string; phone: string }
    const hyphen = `${row.phone.slice(0, 3)}-${row.phone.slice(3, 7)}-${row.phone.slice(7)}`
    expect((await search(hyphen)).some((r) => r.user_id === row.id)).toBe(true)
    expect((await search(row.phone)).some((r) => r.user_id === row.id)).toBe(true)
  })

  it('전화번호 — 하이픈 포함 저장된 회원도 숫자만 입력으로 찾는다', async () => {
    const { data } = await admin.from('user_profiles').select('id, phone').is('deleted_at', null).like('phone', '%-%').limit(1).single()
    const row = data as { id: string; phone: string }
    expect((await search(row.phone.replace(/\D/g, ''))).some((r) => r.user_id === row.id)).toBe(true)
  })

  it('영문이 섞인 입력의 숫자 조각은 전화번호 비교에 쓰이지 않는다(이메일·코드로만 매칭)', async () => {
    const rows = await search('zz987654zz')
    expect(rows).toHaveLength(0)
  })

  it('한글 초성(공백 유무 무관)으로 이름을 찾는다 (#707)', async () => {
    const { data } = await admin.from('user_profiles').select('id, full_name').is('deleted_at', null).not('full_name', 'is', null).limit(50)
    const row = (data as Array<{ id: string; full_name: string }>).find((r) => /^[가-힣]{3}$/.test(r.full_name))
    expect(row, '테스트용 3글자 한글 이름 회원이 필요').toBeTruthy()
    const { data: cs } = await admin.rpc('hangul_chosung', { p_text: row!.full_name })
    const chosung = cs as string
    expect((await search(chosung)).some((r) => r.user_id === row!.id)).toBe(true)
    expect((await search(chosung.slice(0, 2))).some((r) => r.user_id === row!.id)).toBe(true)
    expect((await search(`${chosung[0]} ${chosung.slice(1)}`)).some((r) => r.user_id === row!.id)).toBe(true)
  })

  it('찾을 수 없는 초성은 0건', async () => {
    expect(await search('ㅋㅋㅋㅋㅋㅋㅋ')).toHaveLength(0)
  })
})
