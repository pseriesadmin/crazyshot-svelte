import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * get_rental_list 탭별 정렬·필터 — Stage DB 라이브 통합 시험 (2026-11-20, Migration #842)
 *
 * 완료기준:
 *   정상 동작   : p_sort 별 정렬·방식 필터·결제 단계 필터가 결과 순서·구성에 반영된다.
 *   막아야 할 것 : p_sort 를 안 주면(NULL) 기존 신청일 최신순 그대로 — 모바일 CMS·간트·단건 조회 등 기존 호출부 무회귀.
 *   실패했을 때  : 탭 정렬이 틀리거나, 기존 화면의 목록 순서가 바뀐다.
 * Stage 의 기존 예약 데이터를 읽기만 한다(시드·수정 없음) — 순서·필터 성질을 단언하므로 데이터가 적으면 단언이 약해질 뿐 실패하지는 않는다.
 * 주의: Migration #842 적용 전에는 전부 실패하는 것이 정상.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface Row {
  reservation_id: number
  created_at: string
  rental_start: string
  rental_end: string
  pickup_method: string | null
  return_method: string | null
  pickup_time: string | null
  return_time: string | null
  signing_sent_at: string | null
  customer_signed_at: string | null
  contract_id: string | null
  reservation_code: string | null
  customer_name: string | null
  product_name: string | null
  product_code: string | null
  order_amount: number | null
}

async function list(args: Record<string, unknown>): Promise<Row[]> {
  const { data, error } = await admin.rpc('get_rental_list', {
    p_page: 1, p_per_page: 100, p_group_by_order: true, ...args,
  })
  expect(error).toBeNull()
  return (data ?? []) as Row[]
}

const RANK: Record<string, number> = { crazydelivery: 0, visit: 1, locker: 1, quick: 2 }
const rank = (m: string | null) => RANK[m ?? ''] ?? 3
const minutes = (t: string | null, d: number) => {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(t ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : d
}
const LIFECYCLE = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed']

describe('get_rental_list p_sort (#842)', () => {
  it('p_sort 없음 = 기존 신청일 최신순(기존 호출부 불변)', async () => {
    const rows = await list({ p_include_statuses: LIFECYCLE })
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]
      expect(a.created_at >= b.created_at).toBe(true)
      if (a.created_at === b.created_at) expect(a.reservation_id > b.reservation_id).toBe(true)
    }
    const explicit = await list({ p_include_statuses: LIFECYCLE, p_sort: 'created_desc' })
    expect(explicit.map((r) => r.reservation_id)).toEqual(rows.map((r) => r.reservation_id))
  })

  it('created_asc 는 신청일 오래된 순', async () => {
    const rows = await list({ p_include_statuses: LIFECYCLE, p_sort: 'created_asc' })
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].created_at <= rows[i].created_at).toBe(true)
  })

  it('pickup_asc: 수령일 → 같은 날 크레이지배송→방문→퀵 → 시각 순', async () => {
    const rows = await list({ p_status: 'confirmed', p_include_statuses: ['confirmed'], p_sort: 'pickup_asc' })
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]
      const ka = [a.rental_start, rank(a.pickup_method), minutes(a.pickup_time, 1440)]
      const kb = [b.rental_start, rank(b.pickup_method), minutes(b.pickup_time, 1440)]
      expect(ka[0] < kb[0] || (ka[0] === kb[0] && (ka[1] < kb[1] || (ka[1] === kb[1] && ka[2] <= kb[2])))).toBe(true)
    }
  })

  it('start_asc: 대여 시작일 임박순', async () => {
    const rows = await list({ p_status: 'hold', p_include_statuses: ['hold'], p_sort: 'start_asc' })
    const dated = rows.filter((r) => r.rental_start)
    for (let i = 1; i < dated.length; i++) expect(dated[i - 1].rental_start <= dated[i].rental_start).toBe(true)
  })

  it('return_group_asc: 반납일 → 같은 날 방식 순서', async () => {
    const rows = await list({ p_status: 'in_use', p_include_statuses: ['in_use'], p_sort: 'return_group_asc' })
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]
      expect(a.rental_end < b.rental_end || (a.rental_end === b.rental_end && rank(a.return_method) <= rank(b.return_method))).toBe(true)
    }
  })

  it('changed_desc/changed_asc: 상태 전환 시각 순(완료 탭)', async () => {
    const desc = await list({ p_status: null, p_include_statuses: ['completed', 'damage_claimed'], p_sort: 'changed_desc' })
    const ids = desc.map((r) => r.reservation_id)
    if (ids.length < 2) return
    const { data } = await admin.from('rental_reservations').select('id, status_changed_at').in('id', ids)
    const at = new Map(((data ?? []) as { id: number; status_changed_at: string }[]).map((r) => [r.id, r.status_changed_at]))
    for (let i = 1; i < ids.length; i++) expect((at.get(ids[i - 1]) ?? '') >= (at.get(ids[i]) ?? '')).toBe(true)
    const asc = await list({ p_status: null, p_include_statuses: ['completed', 'damage_claimed'], p_sort: 'changed_asc' })
    expect(asc.map((r) => r.reservation_id)).toEqual([...ids].reverse())
  })
})

describe('get_rental_list 필터 (#842)', () => {
  it('p_pickup_filter: 지정한 수령 방식만 남고 총건수도 줄어든다', async () => {
    const all = await list({ p_status: 'confirmed', p_include_statuses: ['confirmed'] })
    const some = await list({ p_status: 'confirmed', p_include_statuses: ['confirmed'], p_pickup_filter: ['visit', 'locker'] })
    for (const r of some) expect(['visit', 'locker']).toContain(r.pickup_method)
    expect(some.length).toBeLessThanOrEqual(all.length)
    expect(some.length).toBe(all.filter((r) => ['visit', 'locker'].includes(r.pickup_method ?? '')).length)
  })

  it('p_return_filter: 지정한 반납 방식만 남는다', async () => {
    const rows = await list({ p_status: 'in_use', p_include_statuses: ['in_use'], p_return_filter: ['visit'] })
    for (const r of rows) expect(r.return_method).toBe('visit')
  })

  it('p_payment_stage: 미발행=계약서 미발송 / 서명 완료=서명됨 / 결제 진행 중=발송 후 서명 전', async () => {
    const base = { p_status: 'hold', p_include_statuses: ['hold'] }
    for (const r of await list({ ...base, p_payment_stage: 'unissued' })) expect(r.signing_sent_at).toBeNull()
    for (const r of await list({ ...base, p_payment_stage: 'signed' })) expect(r.customer_signed_at).not.toBeNull()
    for (const r of await list({ ...base, p_payment_stage: 'paying' })) {
      expect(r.signing_sent_at).not.toBeNull()
      expect(r.customer_signed_at).toBeNull()
    }
  })
})

describe('get_rental_list 컬럼 정렬 (#843·#844)', () => {
  const ST = { p_include_statuses: ['hold', 'confirmed', 'in_use', 'completed'], p_per_page: 100 }
  const sortedBy = <T>(rows: Row[], pick: (r: Row) => T, dir: 'asc' | 'desc') => {
    const vals = rows.map(pick).filter((v) => v != null) as unknown as (string | number)[]
    for (let i = 1; i < vals.length; i++) expect(dir === 'asc' ? vals[i - 1] <= vals[i] : vals[i - 1] >= vals[i]).toBe(true)
  }
  it('결제금액 오름/내림', async () => {
    sortedBy(await list({ ...ST, p_sort: 'amount_asc' }), (r) => (r.order_amount == null ? null : Number(r.order_amount)), 'asc')
    sortedBy(await list({ ...ST, p_sort: 'amount_desc' }), (r) => (r.order_amount == null ? null : Number(r.order_amount)), 'desc')
  })
  it('계약 상태: 미발행 → 미서명 → 발송중 → 서명완료 (desc 는 역순)', async () => {
    const rank = (r: Row) => (r.customer_signed_at ? 3 : r.signing_sent_at ? 2 : r.contract_id ? 1 : 0)
    sortedBy(await list({ ...ST, p_sort: 'contract_asc' }), rank, 'asc')
    sortedBy(await list({ ...ST, p_sort: 'contract_desc' }), rank, 'desc')
  })
  it('예약번호 정렬(코드는 영문+숫자라 JS 비교와 같다)', async () => {
    sortedBy(await list({ ...ST, p_sort: 'code_asc' }), (r) => r.reservation_code, 'asc')
    sortedBy(await list({ ...ST, p_sort: 'code_desc' }), (r) => r.reservation_code, 'desc')
  })
  it('수령방식 정렬: 방식 순서(크레이지배송 → 방문 → 퀵), desc 는 역순', async () => {
    const base = { p_status: 'confirmed', p_include_statuses: ['confirmed'] }
    const asc = await list({ ...base, p_sort: 'pickup_method_asc' })
    for (let i = 1; i < asc.length; i++) expect(rank(asc[i - 1].pickup_method) <= rank(asc[i].pickup_method)).toBe(true)
    const desc = await list({ ...base, p_sort: 'pickup_method_desc' })
    for (let i = 1; i < desc.length; i++) expect(rank(desc[i - 1].pickup_method) >= rank(desc[i].pickup_method)).toBe(true)
  })
  it('start_desc·end_desc: 일정 먼 순', async () => {
    const a = (await list({ ...ST, p_sort: 'start_desc' })).filter((r) => r.rental_start)
    for (let i = 1; i < a.length; i++) expect(a[i - 1].rental_start >= a[i].rental_start).toBe(true)
    const b = (await list({ ...ST, p_sort: 'end_desc' })).filter((r) => r.rental_end)
    for (let i = 1; i < b.length; i++) expect(b[i - 1].rental_end >= b[i].rental_end).toBe(true)
  })
})

describe('get_rental_list 지연건 고정 (#845)', () => {
  const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
  const due = (r: Row) => r.rental_start != null && `${r.rental_start} ${String(Math.floor(minutes(r.pickup_time, 1440) / 60)).padStart(2, '0')}:${String(minutes(r.pickup_time, 1440) % 60).padStart(2, '0')}` <= kstNow()
  it('pin: 접두어 — 수령 지연 건이 다른 정렬에서도 앞에 오고, 같은 지연 그룹 안에서는 그 정렬을 따른다', async () => {
    const rows = await list({ p_status: 'confirmed', p_include_statuses: ['confirmed'], p_sort: 'pin:amount_desc', p_per_page: 100 })
    const flags = rows.map((r) => (due(r) ? 0 : 1))
    for (let i = 1; i < flags.length; i++) expect(flags[i - 1] <= flags[i]).toBe(true)
  })
  it('pin: 이 없으면 기존 정렬 그대로 — 접두어는 정렬 키 자체를 바꾸지 않는다', async () => {
    const pinned = await list({ p_status: 'confirmed', p_include_statuses: ['confirmed'], p_sort: 'pin:customer_asc', p_per_page: 100 })
    const plain = await list({ p_status: 'confirmed', p_include_statuses: ['confirmed'], p_sort: 'customer_asc', p_per_page: 100 })
    expect(new Set(pinned.map((r) => r.reservation_id))).toEqual(new Set(plain.map((r) => r.reservation_id)))
  })
})

describe('get_rental_list 반납 전환일·방식순 (#846)', () => {
  const kstDay = (ts: string) => new Date(Date.parse(ts) + 9 * 3600 * 1000).toISOString().slice(0, 10)
  async function groupCheck(sort: 'changed_group_desc' | 'changed_group_asc') {
    const rows = await list({ p_status: null, p_include_statuses: ['in_use', 'return_requested', 'returned'], p_inspection_scope: 'returning', p_sort: sort, p_per_page: 100 })
    const ids = rows.map((r) => r.reservation_id)
    if (ids.length < 2) return
    const { data } = await admin.from('rental_reservations').select('id, status_changed_at').in('id', ids)
    const at = new Map(((data ?? []) as { id: number; status_changed_at: string }[]).map((r) => [r.id, r.status_changed_at]))
    for (let i = 1; i < rows.length; i++) {
      const da = kstDay(at.get(rows[i - 1].reservation_id) ?? ''), db = kstDay(at.get(rows[i].reservation_id) ?? '')
      if (da !== db) { expect(sort === 'changed_group_desc' ? da > db : da < db).toBe(true); continue }
      const ra = rank(rows[i - 1].return_method), rb = rank(rows[i].return_method)
      expect(ra <= rb).toBe(true)
      if (ra === rb) {
        const ta = at.get(rows[i - 1].reservation_id) ?? '', tb = at.get(rows[i].reservation_id) ?? ''
        expect(sort === 'changed_group_desc' ? ta >= tb : ta <= tb).toBe(true)
      }
    }
  }
  it('changed_group_desc: 전환일 내림 → 같은 날 방식순 → 전환 시각 내림', async () => { await groupCheck('changed_group_desc') })
  it('changed_group_asc: 전환일 오름 → 같은 날 방식순 → 전환 시각 오름', async () => { await groupCheck('changed_group_asc') })
})
