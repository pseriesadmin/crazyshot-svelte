import { describe, it, expect } from 'vitest'
import {
  applyChange, isNoop, levelsToColumns, parseSettingsChange, requiresSuperadmin, rowToLevels, type SettingsLevels, type SettingsRow,
} from '$lib/server/crazychat/settings-update'
import { kstDayStartIso, rangeSinceIso, summarizeAi, summarizeQuery, type AiObsRow } from '$lib/server/crazychat/stats'

const ROW: SettingsRow = {
  agent_enabled: false, query_enabled: false, query_observe: false, action_enabled: false, action_observe: false, recommend_enabled: false, recommend_observe: false,
  ai_fallback_enabled: false, ai_fallback_observe: false, ai_allowed_categories: [],
}
const base = (o: Partial<SettingsLevels> = {}): SettingsLevels => ({ ...rowToLevels(ROW), ...o })
const parse = (b: unknown) => parseSettingsChange(b)

describe('parseSettingsChange', () => {
  it('정상 값', () => {
    expect(parse({ agent_enabled: true, query: 'observe', ai_fallback: 'off', ai_allowed_categories: [' Reservation ', 'return', 'return'] }))
      .toEqual({ ok: true, change: { agent_enabled: true, query: 'observe', ai_fallback: 'off', ai_allowed_categories: ['reservation', 'return'] } })
  })
  it('추천형(recommend) 단계도 저장 요청으로 받아들인다', () => {
    expect(parse({ recommend: 'observe' })).toEqual({ ok: true, change: { recommend: 'observe' } })
    expect(parse({ recommend: 'on', query: 'off' }).ok).toBe(true)
    expect(parse({ recommend: 'maybe' }).ok).toBe(false)
  })
  it('빈 요청·모르는 키·잘못된 값 거부', () => {
    for (const b of [null, [], 'x', {}, { foo: 1 }, { query: 'maybe' }, { query: 1 }, { agent_enabled: 'yes' }, { ai_allowed_categories: 'a' }, { ai_allowed_categories: [1] }]) {
      expect(parse(b).ok, JSON.stringify(b)).toBe(false)
    }
  })
  it('사람 전용 주제·잘못된 형식·너무 많은 분류는 거부', () => {
    for (const c of ['damage', 'REFUND', ' cancel ', 'personal_info', 'legal', 'lost', 'cs', 'payment_error']) {
      expect(parse({ ai_allowed_categories: [c] }).ok, c).toBe(false)
    }
    expect(parse({ ai_allowed_categories: ['한글'] }).ok).toBe(false)
    expect(parse({ ai_allowed_categories: ['a b'] }).ok).toBe(false)
    expect(parse({ ai_allowed_categories: Array.from({ length: 21 }, (_, i) => `c${i}`) }).ok).toBe(false)
    expect(parse({ ai_allowed_categories: [] }).ok).toBe(true)
  })
})

describe('단계 ↔ DB 열 변환', () => {
  it('on=enabled, observe=observe만, off=둘 다 false', () => {
    const cols = levelsToColumns(base({ agent_enabled: true, query: 'on', action: 'observe', ai_fallback: 'off', ai_allowed_categories: ['general'] }))
    expect(cols).toMatchObject({ agent_enabled: true, query_enabled: true, query_observe: false, action_enabled: false, action_observe: true, ai_fallback_enabled: false, ai_fallback_observe: false, ai_allowed_categories: ['general'] })
  })
  it('열 → 단계 왕복', () => {
    const l = base({ query: 'on', action: 'observe', ai_fallback: 'on' })
    expect(rowToLevels(levelsToColumns(l))).toEqual(l)
  })
  it('enabled와 observe가 둘 다 true인 행은 on으로 본다(settings.ts와 같은 해석)', () => {
    expect(rowToLevels({ ...ROW, query_enabled: true, query_observe: true }).query).toBe('on')
  })
})

describe('변경 적용·무변경 판정', () => {
  it('일부만 바꾸고 나머지는 유지', () => {
    expect(applyChange(base({ query: 'on' }), { action: 'observe' })).toMatchObject({ query: 'on', action: 'observe' })
  })
  it('같은 값이면 무변경(분류 순서 무관)', () => {
    const a = base({ ai_allowed_categories: ['a', 'b'] })
    expect(isNoop(a, applyChange(a, { ai_allowed_categories: ['b', 'a'] }))).toBe(true)
    expect(isNoop(a, applyChange(a, { query: 'observe' }))).toBe(false)
  })
})

describe('requiresSuperadmin — 마스터 ON·AI 켜짐만 슈퍼마스터 전용', () => {
  it('마스터를 켜면 전용, 끄는 것은 누구나', () => {
    expect(requiresSuperadmin(base(), applyChange(base(), { agent_enabled: true }))).toBe(true)
    expect(requiresSuperadmin(base({ agent_enabled: true }), applyChange(base({ agent_enabled: true }), { agent_enabled: false }))).toBe(false)
  })
  it('AI를 켜짐으로 바꾸면 전용, 관찰·꺼짐은 매니저 가능', () => {
    expect(requiresSuperadmin(base(), applyChange(base(), { ai_fallback: 'on' }))).toBe(true)
    expect(requiresSuperadmin(base(), applyChange(base(), { ai_fallback: 'observe' }))).toBe(false)
    expect(requiresSuperadmin(base({ ai_fallback: 'on' }), applyChange(base({ ai_fallback: 'on' }), { ai_fallback: 'off' }))).toBe(false)
  })
  it('AI가 켜짐인 동안 허용 분류 변경은 전용, 꺼져 있으면 매니저 가능', () => {
    const on = base({ ai_fallback: 'on', ai_allowed_categories: ['general'] })
    expect(requiresSuperadmin(on, applyChange(on, { ai_allowed_categories: ['general', 'return'] }))).toBe(true)
    expect(requiresSuperadmin(base(), applyChange(base(), { ai_allowed_categories: ['return'] }))).toBe(false)
  })
  it('조회·접수를 켜짐으로 바꾸는 것은 매니저 가능(마스터가 이미 켜져 있을 때)', () => {
    const m = base({ agent_enabled: true })
    expect(requiresSuperadmin(m, applyChange(m, { query: 'on', action: 'on' }))).toBe(false)
  })
})

describe('stats 집계', () => {
  it('조회·접수 처리율', () => {
    const s = summarizeQuery([
      { mode: 'on', intent: 'return_date', outcome: 'answered' }, { mode: 'on', intent: 'extend', outcome: 'registered' },
      { mode: 'on', intent: 'doc_status', outcome: 'not_found' }, { mode: 'on', intent: 'doc_status', outcome: 'no_data' },
    ])
    expect(s).toMatchObject({ total: 4, answerRate: 0.5, byOutcome: { answered: 1, registered: 1 } })
    expect(summarizeQuery([]).answerRate).toBeNull()
  })
  const ai = (o: Partial<AiObsRow>): AiObsRow => ({ mode: 'observe', outcome: 'answered', reason: null, sent: false, input_tokens: 100, output_tokens: 10, feedback: null, ...o })
  it('AI 집계: pending 제외·토큰 합·사유별·정답률', () => {
    const rows: AiObsRow[] = [
      ai({}), ai({ feedback: 1 }), ai({ feedback: 0 }), ai({ outcome: 'invalid', reason: 'promise' }), ai({ outcome: 'pending', input_tokens: null }),
      ai({ outcome: 'error', reason: 'call_failed', input_tokens: null, output_tokens: null }),
    ]
    const s = summarizeAi(rows)
    expect(s).toMatchObject({ calls: 5, answered: 3, inputTokens: 400, outputTokens: 40, reviewed: 2, correct: 1, wrong: 1, accuracy: 0.5, ready: false })
    expect(s.byReason).toEqual({ promise: 1, call_failed: 1 })
    expect(s.passRate).toBeCloseTo(0.6)
  })
  it('검토 50건 이상·정답률 90% 이상이면 ready', () => {
    const mk = (c: number, w: number) => summarizeAi([...Array.from({ length: c }, () => ai({ feedback: 1 })), ...Array.from({ length: w }, () => ai({ feedback: 0 }))])
    expect(mk(45, 5).ready).toBe(true)
    expect(mk(44, 6).ready).toBe(false) // 88%
    expect(mk(40, 0).ready).toBe(false) // 검토 부족
  })
  it('KST 하루 시작', () => {
    expect(kstDayStartIso(new Date('2026-10-07T20:00:00Z'))).toBe('2026-10-07T15:00:00.000Z') // KST 10/8 05:00 → 10/8 00:00 KST
    expect(kstDayStartIso(new Date('2026-10-07T10:00:00Z'))).toBe('2026-10-06T15:00:00.000Z')
    expect(rangeSinceIso('all')).toBeNull()
    expect(rangeSinceIso('7d', new Date('2026-10-08T00:00:00Z'))).toBe('2026-10-01T00:00:00.000Z')
  })
})
