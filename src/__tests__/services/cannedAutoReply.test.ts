import { describe, it, expect, vi } from 'vitest'
import { activeModel, buildObservationRow, decideAutoReply, recordObservation, WAIT_REPLY, WAIT_SUPPRESS_MINUTES } from '$lib/server/cannedAutoReply'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

/**
 * 자동답변 호출부 도우미 — 판정(규칙+모델)·관찰 기록 행·fail-soft 저장
 */
const mk = (id: string, title: string, kws: string[], extra: Partial<CannedResponseForMatch> = {}): CannedResponseForMatch => ({
  id, title, content: `${title} 본문`, category: null, shortcut: null, match_keywords: kws, usage_count: 0, ...extra,
})
const cands = [
  mk('dep', '보증금은 얼마인가요?', ['보증금', '보증'], { shortcut: '보증금' }),
  mk('ret', '반납 안내 기본', ['반납', '반납방법'], { shortcut: '반납' }),
]

describe('활성 모델·상수', () => {
  it('저장소의 가중치 파일이 검증을 통과해 로드된다', () => {
    expect(activeModel.weights.length).toBe(activeModel.featureNames.length)
    expect(activeModel.threshold).toBeGreaterThan(0)
    expect(activeModel.threshold).toBeLessThanOrEqual(1)
  })
  it('대기 안내 문구와 억제 시간', () => {
    expect(WAIT_REPLY).toContain('담당자')
    expect(WAIT_SUPPRESS_MINUTES).toBe(5)
  })
})

describe('decideAutoReply', () => {
  it('분명한 질문은 답변(answer)을 돌려준다', () => {
    const d = decideAutoReply('보증금 얼마예요?', cands, [])
    expect(d.answer?.id).toBe('dep')
    expect(d.verdict.decision).toBe('answer')
    expect(d.verdict.probability).toBeGreaterThanOrEqual(activeModel.threshold)
  })
  it('엉뚱한 질문은 답변이 없다(null)', () => {
    const d = decideAutoReply('진짜 별로네요 답변이 너무 느려요', cands, [])
    expect(d.answer).toBeNull()
    expect(d.verdict.decision).toBe('wait')
  })
  it('임계값을 1로 올린 모델이면 규칙이 답변이어도 대기(모델이 최종 판정에 관여)', () => {
    const strict = { ...activeModel, threshold: 1 }
    const d = decideAutoReply('보증금 얼마예요?', cands, [], strict)
    expect(d.evaluation.decision).toBe('answer')
    expect(d.answer).toBeNull()
    expect(d.verdict.reason).toBe('low_probability')
  })
})

describe('buildObservationRow', () => {
  it('답변 판정: 후보·확률·특징값이 담기고 원문은 없다', () => {
    const d = decideAutoReply('보증금 얼마예요?', cands, [])
    const row = buildObservationRow('msg-1', 'observe', d)
    expect(row).toMatchObject({ message_id: 'msg-1', mode: 'observe', rule_decision: 'answer', model_decision: 'answer', best_canned_id: 'dep', would_send: true, model_version: activeModel.version })
    expect(row.probability).not.toBeNull()
    expect(row.features).not.toBeNull()
    expect(row.top.length).toBeGreaterThan(0)
    expect(JSON.stringify(row)).not.toContain('얼마예요')
  })
  it('미매칭: 후보 없음·would_send=false·특징값 null', () => {
    const d = decideAutoReply('진짜 별로네요 답변이 너무 느려요', cands, [])
    const row = buildObservationRow('msg-2', 'on', d)
    expect(row).toMatchObject({ mode: 'on', would_send: false, best_canned_id: null, features: null, probability: null })
  })
  it('확률은 소수 4자리로 반올림된다', () => {
    const d = decideAutoReply('보증금 얼마예요?', cands, [])
    const row = buildObservationRow('m', 'on', d)
    expect(String(row.probability).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4)
  })
})

describe('recordObservation — fail-soft', () => {
  const row = buildObservationRow('m', 'observe', decideAutoReply('보증금', cands, []))
  const adminWith = (result: unknown | Error) => ({
    from: vi.fn(() => ({ insert: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))) })),
  })

  it('정상 저장은 오류 없이 끝난다', async () => {
    await expect(recordObservation(adminWith({ error: null }) as never, row)).resolves.toBeUndefined()
  })
  it('DB 오류·예외도 던지지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordObservation(adminWith({ error: { message: 'x', code: '42P01' } }) as never, row)).resolves.toBeUndefined()
    await expect(recordObservation(adminWith(new Error('network')) as never, row)).resolves.toBeUndefined()
    spy.mockRestore()
  })
  it('올바른 테이블에 저장한다', async () => {
    const admin = adminWith({ error: null })
    await recordObservation(admin as never, row)
    expect(admin.from).toHaveBeenCalledWith('canned_match_observations')
  })
})
