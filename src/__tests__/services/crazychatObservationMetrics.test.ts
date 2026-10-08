import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordObservation, type RecommendObservationMetrics } from '$lib/server/crazychat/shared'

/**
 * recordObservation — 메트릭 컬럼(Migration 672)이 아직 없는 DB에서도 관찰 기록이 사라지지 않는다.
 *   1. 메트릭 없이 호출하면 기존 그대로 1회 삽입
 *   2. 메트릭 포함 삽입 성공 → 재시도 없음
 *   3. 컬럼 없음 오류(42703 / PGRST204 / 메시지) → 메트릭 없이 1회 재시도
 *   4. 그 외 오류 → 재시도하지 않음(fail-soft, 던지지 않음)
 *   5. 재시도도 실패 → 던지지 않음
 */
const row = { message_id: 'm1', mode: 'observe' as const, intent: 'recommend' as const, outcome: 'answered' as const, group_count: 2 }
const metrics: RecommendObservationMetrics = { top_score: 30, card_scores: [30, 29], product_ids: ['a', 'b'], min_score_used: 4, expanded: false }

let inserts: Array<Record<string, unknown>>
let results: Array<{ error: { code?: string; message: string } | null }>
const admin = { from: () => ({ insert: async (r: Record<string, unknown>) => { inserts.push(r); return results.shift() ?? { error: null } } }) }

beforeEach(() => { inserts = []; results = []; vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('recordObservation 메트릭', () => {
  it('메트릭 없이 호출하면 기존 행 그대로 1회 삽입', async () => {
    await recordObservation(admin, row)
    expect(inserts).toEqual([row])
  })
  it('메트릭 포함 삽입이 성공하면 재시도하지 않는다', async () => {
    await recordObservation(admin, row, metrics)
    expect(inserts).toEqual([{ ...row, ...metrics }])
  })
  it('컬럼 없음 오류(42703)면 메트릭 없이 1회 재시도한다', async () => {
    results = [{ error: { code: '42703', message: 'column "top_score" of relation does not exist' } }]
    await recordObservation(admin, row, metrics)
    expect(inserts).toEqual([{ ...row, ...metrics }, row])
  })
  it('PostgREST 스키마 캐시 오류(PGRST204)도 같은 재시도', async () => {
    results = [{ error: { code: 'PGRST204', message: "Could not find the 'top_score' column of 'crazychat_query_observations' in the schema cache" } }]
    await recordObservation(admin, row, metrics)
    expect(inserts).toEqual([{ ...row, ...metrics }, row])
  })
  it('코드 없이 메시지만 있어도 컬럼 없음이면 재시도', async () => {
    results = [{ error: { message: 'column "expanded" does not exist' } }]
    await recordObservation(admin, row, metrics)
    expect(inserts).toHaveLength(2)
  })
  it('그 외 오류는 재시도하지 않고 던지지도 않는다', async () => {
    results = [{ error: { code: '23503', message: 'violates foreign key constraint' } }]
    await expect(recordObservation(admin, row, metrics)).resolves.toBeUndefined()
    expect(inserts).toHaveLength(1)
  })
  it('재시도도 실패하면 던지지 않는다', async () => {
    results = [{ error: { code: '42703', message: 'column does not exist' } }, { error: { code: '23503', message: 'fk' } }]
    await expect(recordObservation(admin, row, metrics)).resolves.toBeUndefined()
    expect(inserts).toHaveLength(2)
  })
  it('메트릭 없는 호출의 컬럼 오류는 재시도 대상이 아니다', async () => {
    results = [{ error: { code: '42703', message: 'column does not exist' } }]
    await recordObservation(admin, row)
    expect(inserts).toHaveLength(1)
  })
})
