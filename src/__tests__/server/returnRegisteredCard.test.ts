import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 고객 반납등록 완료 → 상담 채팅 세션에 '반납등록 확인' 카드 (2026-11-12, Stephen 지시)
 *  · 고객 발신(sender_type 'user') action_card, type 'return_submitted', 관리자 CTA 문구 '반납등록 확인'
 *  · 같은 예약에는 1번만(중복 방지), 세션은 공유 RPC(find_or_create_general_chat_session)로 확보
 *  · 제출 API 가 제출 성공 뒤 호출(fail-soft)
 *  · 관리자 CTA 는 예약 패널을 검수 탭으로 연다 / 고객 화면에는 CTA 없이 안내 문구만
 */
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: vi.fn(async () => undefined) }))
const { postReturnRegisteredCard } = await import('$lib/server/returnRegisteredCard')

function makeAdmin(opts: { existing?: boolean; sessionId?: string | null; sessionErr?: boolean; insertErr?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = []
  const chain = (table: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'limit']) c[m] = () => c
    c.maybeSingle = async () => ({ data: table === 'rental_reservations' ? { reservation_code: 'CSRSV1', start_date: '2026-11-01', end_date: '2026-11-03', products: { name: 'Sony FX3' } } : null, error: null })
    c.insert = async (row: Record<string, unknown>) => { inserted.push(row); return { error: opts.insertErr ? { message: 'x' } : null } }
    c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: opts.existing && table === 'chat_messages' ? [{ id: 1 }] : [], error: null }).then(res)
    return c
  }
  return {
    inserted,
    client: {
      from: (t: string) => chain(t),
      rpc: vi.fn(async () => ({ data: opts.sessionId === undefined ? 'sess-1' : opts.sessionId, error: opts.sessionErr ? { message: 'x' } : null })),
    } as never,
  }
}

describe('postReturnRegisteredCard', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })

  it('고객 발신 return_submitted 카드를 고객 세션에 남긴다(관리자 CTA 문구·예약 정보·검수 링크 포함)', async () => {
    const { inserted, client } = makeAdmin()
    const r = await postReturnRegisteredCard(client, 'u1', 335)
    expect(r).toEqual({ ok: true })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ session_id: 'sess-1', sender_type: 'user', message_type: 'action_card' })
    expect(inserted[0].action_payload).toMatchObject({
      type: 'return_submitted',
      reservation_id: '335',
      reservation_no: 'CSRSV1',
      product_name: 'Sony FX3',
      rental_period: '2026-11-01 ~ 2026-11-03',
      button_label: '반납등록 확인',
      action_url: '/cms/rentals?status=returning&selected=335',
    })
  })

  it('세션은 공유 RPC 로 확보한다(직접 조회 금지, service-operations §11)', async () => {
    const { client } = makeAdmin()
    await postReturnRegisteredCard(client, 'u1', 335)
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('find_or_create_general_chat_session', { p_user_id: 'u1', p_reservation_id: 335 })
  })

  it('같은 예약에 이미 카드가 있으면 새로 만들지 않는다', async () => {
    const { inserted, client } = makeAdmin({ existing: true })
    expect(await postReturnRegisteredCard(client, 'u1', 335)).toEqual({ ok: true, duplicate: true })
    expect(inserted).toHaveLength(0)
  })

  it('세션 확보·삽입이 실패하면 ok:false(호출부는 제출을 성공으로 두고 로그만 남긴다)', async () => {
    expect((await postReturnRegisteredCard(makeAdmin({ sessionId: null }).client, 'u1', 335)).ok).toBe(false)
    expect((await postReturnRegisteredCard(makeAdmin({ insertErr: true }).client, 'u1', 335)).ok).toBe(false)
  })
})

describe('연결 지점 소스 가드', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  it('제출 API 가 제출 저장·반납요청 전환 뒤 카드를 남기고 실패해도 제출은 성공이다(try/catch)', () => {
    const s = read('src/routes/api/account/rental/[id]/return-submit/+server.ts')
    expect(s).toContain("import { postReturnRegisteredCard } from '$lib/server/returnRegisteredCard'")
    const call = s.indexOf('await postReturnRegisteredCard(')
    expect(call).toBeGreaterThan(s.indexOf("p_new_status: 'return_requested'"))
    expect(call).toBeLessThan(s.indexOf("return json({ ok: true })"))
    expect(s.slice(call - 40, call + 200)).toMatch(/try \{[\s\S]*postReturnRegisteredCard[\s\S]*\} catch/)
  })
  it('관리자 CTA 는 검수 탭으로, 고객 화면은 CTA 없이 안내만', () => {
    const c = read('src/lib/components/chat/ActionCard.svelte')
    expect(c).toContain("payload.type === 'return_submitted' ? 'inspection' : undefined")
    expect(c).toMatch(/payload\.type === 'return_submitted' && !isAdmin/)
    expect(c).toContain("case 'return_submitted':       return { label: '반납등록 확인'")
    expect(read('src/lib/types/chat.ts')).toContain("initialTab?: 'rental' | 'contract' | 'inspection'")
  })
})
