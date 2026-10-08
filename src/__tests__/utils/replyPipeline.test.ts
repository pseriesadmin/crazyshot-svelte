/**
 * TDD: 자동답변 스위치 전체 현황 — 빠른답변 + 크레이지챗 4기능을 고객 메시지가 거치는 순서대로 한 줄 요약 (2026-10-08)
 */
import { describe, it, expect } from 'vitest'
import { buildReplyPipeline } from '$lib/utils/replyPipeline'

const settings = (o: Partial<{ agent_enabled: boolean; query: string; action: string; recommend: string; ai_fallback: string }> = {}) => ({
  agent_enabled: true, query: 'on', action: 'on', recommend: 'on', ai_fallback: 'off', ...o,
}) as never

describe('buildReplyPipeline', () => {
  it('고객 메시지가 거치는 순서: 빠른답변 → 조회형 → 접수형 → 추천형 → AI 답변', () => {
    const p = buildReplyPipeline({ enabled: true, observe_mode: false }, settings())
    expect(p.map((s) => s.key)).toEqual(['quick', 'query', 'action', 'recommend', 'ai_fallback'])
    expect(p.map((s) => s.state)).toEqual(['on', 'on', 'on', 'on', 'off'])
  })
  it('빠른답변: 켜짐이 우선, 꺼짐이어도 관찰 모드면 관찰, 둘 다 꺼짐이면 꺼짐', () => {
    expect(buildReplyPipeline({ enabled: true, observe_mode: true }, settings())[0].state).toBe('on')
    expect(buildReplyPipeline({ enabled: false, observe_mode: true }, settings())[0].state).toBe('observe')
    expect(buildReplyPipeline({ enabled: false, observe_mode: false }, settings())[0].state).toBe('off')
  })
  it('크레이지챗 마스터가 꺼져 있으면 4기능은 설정이 켜져 있어도 stopped(정지) — 빠른답변은 영향 없음', () => {
    const p = buildReplyPipeline({ enabled: true, observe_mode: false }, settings({ agent_enabled: false }))
    expect(p.map((s) => s.state)).toEqual(['on', 'stopped', 'stopped', 'stopped', 'off'])
    expect(p[1].note).toContain('마스터')
  })
  it('마스터가 꺼져 있고 기능도 꺼짐이면 그냥 off', () => {
    expect(buildReplyPipeline(null, settings({ agent_enabled: false, query: 'off' }))[1].state).toBe('off')
  })
  it('설정을 못 읽으면(null) 빠른답변은 unknown, 크레이지챗은 전부 unknown', () => {
    const p = buildReplyPipeline(null, null)
    expect(p.every((s) => s.state === 'unknown')).toBe(true)
  })
  it('AI 답변 칸에는 허용 분류 수를 안내한다', () => {
    const p = buildReplyPipeline({ enabled: true, observe_mode: false }, settings({ ai_fallback: 'on' }), 3)
    expect(p[4].note).toContain('3')
  })
})
