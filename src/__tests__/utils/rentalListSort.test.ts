import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  RENTAL_TAB_CONFIG, rentalTabKeyOf, resolveRentalSort, resolveRentalFilter, isApplicationOverdue,
  nextSortForColumn, sortOptionsForColumn, GENERIC_COLUMN_SORTS, findRentalSortOption, rpcSortFor,
  type RentalTabKey,
} from '$lib/utils/rentalListSort'

// '예약대여현황 탭별 정렬·필터 정리 v1'(2026-11-20) — 탭별 기본 정렬·추가 정렬·필터 옵션

describe('탭별 기본 정렬 (CSV 기본 정렬 열)', () => {
  const DEFAULTS: Record<RentalTabKey, string> = {
    draft: 'created_desc',
    hold: 'start_asc',
    contract_pending: 'start_asc',
    confirmed: 'pickup_asc',
    shipped: 'delay_pickup_asc',
    in_use: 'delay_return_asc',
    returning: 'changed_group_desc',
    inspection: 'created_desc',
    completed: 'changed_desc',
    cancelled_refunded: 'changed_desc',
  }
  for (const [tab, def] of Object.entries(DEFAULTS)) {
    it(`${tab} 기본 = ${def}`, () => {
      expect(RENTAL_TAB_CONFIG[tab as RentalTabKey].defaultSort).toBe(def)
      expect(resolveRentalSort(tab as RentalTabKey, null).value).toBe(def)
    })
  }
  it('기본 정렬은 항상 그 탭의 옵션 목록 안에 있다', () => {
    for (const cfg of Object.values(RENTAL_TAB_CONFIG)) {
      expect(cfg.sorts.some((s) => s.value === cfg.defaultSort)).toBe(true)
    }
  })
})

describe('resolveRentalSort — URL 값 검증', () => {
  it('이 탭 옵션이 아닌 값은 기본 정렬로 되돌린다', () => {
    expect(resolveRentalSort('draft', 'pickup_asc').value).toBe('created_desc')
    expect(resolveRentalSort('confirmed', 'bogus').value).toBe('pickup_asc')
  })
  it('추가 정렬 옵션 선택', () => {
    expect(resolveRentalSort('confirmed', 'changed_asc').rpc).toBe('changed_asc')
    expect(resolveRentalSort('in_use', 'changed_desc').rpc).toBe('changed_desc')
  })
  it('반납 진행 단계순은 DB 정렬(전환 최신) + 페이지 내 단계 정렬 표시', () => {
    const o = resolveRentalSort('returning', 'return_stage')
    expect(o.rpc).toBe('changed_desc')
    expect(o.returnStage).toBe(true)
  })
  it('반납중 기본 = 전환 최신순 + 같은 반납일 방식순, 검수 기본 = 등록 최신순·필터 없음 (Stephen 확정 2026-11-21)', () => {
    expect(RENTAL_TAB_CONFIG.returning.sorts[0]).toMatchObject({ value: 'changed_group_desc', column: 'status', dir: 'desc' })
    expect(RENTAL_TAB_CONFIG.inspection.defaultSort).toBe('created_desc')
    expect(RENTAL_TAB_CONFIG.inspection.filter).toBeUndefined()
  })
  it('배송중은 추가 정렬 없음(CSV)', () => {
    expect(RENTAL_TAB_CONFIG.shipped.sorts).toHaveLength(1)
  })
})

describe('rentalTabKeyOf', () => {
  it('신청대기·계약대기는 같은 hold 지만 contractPending 으로 갈린다', () => {
    expect(rentalTabKeyOf('hold', false)).toBe('hold')
    expect(rentalTabKeyOf('hold', true)).toBe('contract_pending')
    expect(rentalTabKeyOf('returning', false)).toBe('returning')
    expect(rentalTabKeyOf('unknown', false)).toBeNull()
    // 주소창 값이 프로토타입 키여도 알 수 없는 값으로 처리(로더 500 방지)
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(rentalTabKeyOf(k, false)).toBeNull()
  })
})

describe('resolveRentalFilter — 필터 검증·변환', () => {
  it('필터가 없는 탭은 비어 있다', () => {
    expect(resolveRentalFilter('completed', 'visit').selected).toEqual([])
  })
  it('출고 옵션(계약완료): 방문픽업은 무인보관함도 포함, 복수 선택', () => {
    const r = resolveRentalFilter('confirmed', 'visit,quick')
    expect(r.pickup).toEqual(['visit', 'locker', 'quick'])
    expect(r.return).toBeNull()
  })
  it('반납 옵션(대여중·반납중)은 return 인자로 간다', () => {
    expect(resolveRentalFilter('in_use', 'crazydelivery').return).toEqual(['crazydelivery'])
    expect(resolveRentalFilter('returning', 'quick').pickup).toBeNull()
  })
  it('배송중 출고 옵션은 크레이지배송·퀵서비스만(방문 없음)', () => {
    expect(RENTAL_TAB_CONFIG.shipped.filter?.options.map((o) => o.value)).toEqual(['crazydelivery', 'quick'])
    expect(resolveRentalFilter('shipped', 'visit').selected).toEqual([])
  })
  it('계약대기 결제 상태는 단일 선택', () => {
    const r = resolveRentalFilter('contract_pending', 'signed,paying')
    expect(r.payment).toBe('signed')
    expect(r.selected).toEqual(['signed'])
  })
  it('알 수 없는 값은 무시', () => {
    expect(resolveRentalFilter('confirmed', 'bogus').pickup).toBeNull()
  })
})

describe('isApplicationOverdue — 신청대기 지연', () => {
  const NOW = new Date('2026-11-20T05:00:00Z') // 14:00 KST
  it('대여 시작일이 오늘(KST)보다 앞서면 지연', () => {
    expect(isApplicationOverdue('2026-11-19', NOW)).toBe(true)
    expect(isApplicationOverdue('2026-11-20', NOW)).toBe(false)
    expect(isApplicationOverdue(null, NOW)).toBe(false)
  })
})

describe('표 헤더 정렬 — 컬럼별 옵션 순환', () => {
  it('모든 정렬 옵션은 헤더 컬럼과 방향을 가진다', () => {
    for (const cfg of Object.values(RENTAL_TAB_CONFIG)) {
      for (const o of cfg.sorts) {
        expect(['status', 'period', 'created']).toContain(o.column)
        expect(['asc', 'desc']).toContain(o.dir)
      }
    }
  })
  it('상태 헤더 = 전환 시점 최신 → 오래된 순(반납중은 단계순까지) 순환', () => {
    expect(nextSortForColumn('confirmed', 'pickup_asc', 'status')?.value).toBe('changed_desc')
    expect(nextSortForColumn('confirmed', 'changed_desc', 'status')?.value).toBe('changed_asc')
    expect(nextSortForColumn('confirmed', 'changed_asc', 'status')?.value).toBe('changed_desc')
    expect(sortOptionsForColumn('returning', 'status').map((o) => o.value)).toEqual(['changed_group_desc', 'changed_group_asc', 'return_stage'])
  })
  it('대여기간 헤더 = 탭의 예정일시 정렬(수령/반납/시작일)', () => {
    expect(nextSortForColumn('confirmed', 'changed_desc', 'period')?.value).toBe('pickup_asc')
    expect(nextSortForColumn('shipped', 'delay_pickup_asc', 'period')?.value).toBe('start_desc')
    expect(nextSortForColumn('shipped', 'start_desc', 'period')?.value).toBe('delay_pickup_asc')
    expect(nextSortForColumn('in_use', 'changed_asc', 'period')?.value).toBe('delay_return_asc')
    expect(nextSortForColumn('hold', 'created_desc', 'period')?.value).toBe('start_asc')
  })
  it('신청일 헤더 = 신청일 최신/오래된 순(신청대기·임시예약)', () => {
    expect(nextSortForColumn('hold', 'start_asc', 'created')?.value).toBe('created_desc')
    expect(nextSortForColumn('hold', 'created_desc', 'created')?.value).toBe('created_asc')
    expect(nextSortForColumn('draft', 'created_desc', 'created')?.value).toBe('created_asc')
  })
  it('표의 모든 컬럼은 모든 탭에서 정렬 옵션을 가진다(탭 전용 없으면 컬럼 기본 정렬)', () => {
    const cols = Object.keys(GENERIC_COLUMN_SORTS) as (keyof typeof GENERIC_COLUMN_SORTS)[]
    expect(cols).toHaveLength(11)
    for (const tab of Object.keys(RENTAL_TAB_CONFIG) as (keyof typeof RENTAL_TAB_CONFIG)[]) {
      for (const c of cols) {
        const opts = sortOptionsForColumn(tab, c)
        expect(opts.length).toBeGreaterThan(0)
        for (const o of opts) expect(o.column).toBe(c)
      }
    }
  })
  it('컬럼 기본 정렬은 오름/내림이 순환한다', () => {
    expect(nextSortForColumn('completed', 'changed_desc', 'customer')?.value).toBe('customer_asc')
    expect(nextSortForColumn('completed', 'customer_asc', 'customer')?.value).toBe('customer_desc')
    expect(nextSortForColumn('completed', 'customer_desc', 'customer')?.value).toBe('customer_asc')
    expect(nextSortForColumn('hold', 'start_asc', 'amount')?.value).toBe('amount_asc')
    expect(nextSortForColumn('confirmed', 'pickup_asc', 'pickupMethod')?.value).toBe('pickup_method_asc')
  })
  it('탭 전용 대여기간 정렬 뒤에 반대 방향이 붙는다', () => {
    expect(sortOptionsForColumn('confirmed', 'period').map((o) => o.value)).toEqual(['pickup_asc', 'start_desc'])
    expect(sortOptionsForColumn('in_use', 'period').map((o) => o.value)).toEqual(['delay_return_asc', 'end_desc'])
    expect(sortOptionsForColumn('completed', 'period').map((o) => o.value)).toEqual(['start_asc', 'start_desc'])
  })
  it('URL 의 컬럼 정렬 값도 이 탭에서 받아들이고 알 수 없는 값은 기본으로', () => {
    expect(resolveRentalSort('completed', 'code_desc').value).toBe('code_desc')
    expect(resolveRentalSort('completed', 'nope').value).toBe('changed_desc')
    expect(findRentalSortOption('hold', 'amount_desc')?.column).toBe('amount')
    expect(findRentalSortOption('hold', 'nope')).toBeNull()
  })
})

describe('배송중 지연건 최상단 고정 (#845)', () => {
  it('배송중만 고정 — 기본 정렬은 그대로, 다른 정렬은 pin: 접두어', () => {
    expect(RENTAL_TAB_CONFIG.shipped.pinDelayed).toBe(true)
    expect(rpcSortFor('shipped', findRentalSortOption('shipped', 'delay_pickup_asc'))).toBe('delay_pickup_asc')
    expect(rpcSortFor('shipped', findRentalSortOption('shipped', 'customer_asc'))).toBe('pin:customer_asc')
    expect(rpcSortFor('shipped', findRentalSortOption('shipped', 'changed_desc'))).toBe('pin:changed_desc')
  })
  it('다른 탭은 고정 없음', () => {
    for (const t of ['hold', 'confirmed', 'in_use', 'returning', 'completed'] as const) {
      expect(rpcSortFor(t, findRentalSortOption(t, 'customer_asc'))).toBe('customer_asc')
    }
    expect(rpcSortFor('confirmed', null)).toBeNull()
  })
})

describe('DB 연결 소스 가드 (#842)', () => {
  const sql = ['20261120120000_842_rental_list_sort_filter', '20261120150000_843_rental_list_method_sort', '20261120160000_844_rental_list_column_sort', '20261121100000_845_rental_list_pin_delayed', '20261121110000_846_rental_list_changed_group_sort']
    .map((f) => readFileSync(`supabase/migrations/${f}.sql`, 'utf8')).join('\n')
  it('p_sort 가 쓰는 키가 TS 옵션의 rpc 값을 모두 포함한다', () => {
    const rpcKeys = new Set([
      ...Object.values(RENTAL_TAB_CONFIG).flatMap((c) => c.sorts.map((s) => s.rpc)),
      ...Object.values(GENERIC_COLUMN_SORTS).flatMap((l) => l.map((s) => s.rpc)),
      'start_desc', 'end_desc',
    ])
    // 정렬 조건은 E'…' 문자열 안에 있어 따옴표가 두 번(''key'') 이스케이프돼 있다
    rpcKeys.delete('created_desc') // 신청일 최신순은 별도 분기 없이 마지막 폴백 정렬이다
    for (const key of rpcKeys) expect(sql).toContain(`''${key}''`)
  })
  it('기본 호출자 보호 — p_sort NULL 이면 신청일 최신순 폴백', () => {
    expect(sql).toContain('{created} DESC, {id} DESC')
    expect(sql).toContain('p_sort text DEFAULT NULL::text')
  })
  it('로더가 탭별 정렬 인자를 get_rental_list 에 전달한다', () => {
    const loader = readFileSync('src/routes/cms/rentals/+page.server.ts', 'utf8')
    expect(loader).toContain('...sortArgs')
    expect(loader).toContain('sortArgs,')
  })
})
