import { describe, it, expect, vi } from 'vitest'
import {
  ALL_OFF,
  HUMAN_ONLY_TOPICS,
  isHumanOnlyTopic,
  isTopicAllowedForAi,
  loadCrazychatSettings,
  parseCrazychatSettings,
  resolveFeatureMode,
} from '$lib/server/crazychat/settings'

/**
 * 크레이지챗 S1 — 기능 플래그·킬스위치 (순수 함수 + 안전 폴백)
 * 원칙: 기본값은 전부 OFF, 마스터(agent_enabled)가 꺼져 있으면 어떤 기능도 동작하지 않는다.
 *       값이 이상하거나 설정 조회가 실패하면 항상 "꺼짐"으로 해석한다(true가 아닌 값은 모두 false).
 */
const on = (extra: Record<string, unknown> = {}) => ({
  agent_enabled: true,
  query_enabled: true, query_observe: false,
  action_enabled: true, action_observe: false,
  ai_fallback_enabled: true, ai_fallback_observe: false,
  ai_allowed_categories: ['general'],
  ...extra,
})

describe('기본값 — 전부 OFF', () => {
  it('ALL_OFF: 마스터·모든 기능 꺼짐, 허용 주제 없음', () => {
    expect(ALL_OFF.agentEnabled).toBe(false)
    for (const f of ['query', 'action', 'aiFallback'] as const) {
      expect(ALL_OFF[f]).toEqual({ enabled: false, observe: false })
    }
    expect(ALL_OFF.aiAllowedCategories).toEqual([])
  })
  it('ALL_OFF는 변경할 수 없다(동결)', () => {
    expect(Object.isFrozen(ALL_OFF)).toBe(true)
    expect(() => { (ALL_OFF as { agentEnabled: boolean }).agentEnabled = true }).toThrow()
  })
  it('null·undefined·빈 객체·이상한 타입은 전부 ALL_OFF와 같은 결과', () => {
    for (const bad of [null, undefined, {}, [], 'x', 1, true]) {
      expect(parseCrazychatSettings(bad)).toEqual(ALL_OFF)
    }
  })
})

describe('parseCrazychatSettings — 엄격 해석', () => {
  it('정상 행을 구조화한다', () => {
    const s = parseCrazychatSettings(on({ query_observe: true }))
    expect(s.agentEnabled).toBe(true)
    expect(s.query).toEqual({ enabled: true, observe: true })
    expect(s.aiAllowedCategories).toEqual(['general'])
  })
  it("true(boolean)만 켜짐 — 'true'·1·'yes'는 꺼짐", () => {
    const s = parseCrazychatSettings({ agent_enabled: 'true', query_enabled: 1, action_enabled: 'yes', ai_fallback_enabled: {} })
    expect(s.agentEnabled).toBe(false)
    expect(s.query.enabled).toBe(false)
    expect(s.action.enabled).toBe(false)
    expect(s.aiFallback.enabled).toBe(false)
  })
  it('허용 주제는 문자열 배열만, 공백·빈 값·중복 제거', () => {
    const s = parseCrazychatSettings(on({ ai_allowed_categories: ['general', ' general ', '', 3, null, 'reservation'] }))
    expect(s.aiAllowedCategories).toEqual(['general', 'reservation'])
  })
  it('허용 주제가 배열이 아니면 빈 목록', () => {
    expect(parseCrazychatSettings(on({ ai_allowed_categories: 'general' })).aiAllowedCategories).toEqual([])
  })
  it('사람 전용 주제는 허용 목록에 있어도 제거된다(이중 방어)', () => {
    const s = parseCrazychatSettings(on({ ai_allowed_categories: ['general', 'damage', 'refund', 'legal'] }))
    expect(s.aiAllowedCategories).toEqual(['general'])
  })
})

describe('resolveFeatureMode — 킬스위치', () => {
  it('마스터 OFF면 켜진 기능도 전부 off (즉시 정지)', () => {
    const s = parseCrazychatSettings(on({ agent_enabled: false, query_observe: true }))
    expect(resolveFeatureMode(s, 'query')).toBe('off')
    expect(resolveFeatureMode(s, 'action')).toBe('off')
    expect(resolveFeatureMode(s, 'aiFallback')).toBe('off')
  })
  it('마스터 ON + 기능 enabled → on', () => {
    const s = parseCrazychatSettings(on())
    expect(resolveFeatureMode(s, 'query')).toBe('on')
  })
  it('마스터 ON + enabled=false + observe=true → observe(고객에게 미발송)', () => {
    const s = parseCrazychatSettings(on({ query_enabled: false, query_observe: true }))
    expect(resolveFeatureMode(s, 'query')).toBe('observe')
  })
  it('enabled와 observe가 모두 켜져 있으면 on (기존 자동답변과 같은 규칙)', () => {
    const s = parseCrazychatSettings(on({ action_observe: true }))
    expect(resolveFeatureMode(s, 'action')).toBe('on')
  })
  it('기능마다 독립 — 하나만 켜도 나머지는 off', () => {
    const s = parseCrazychatSettings(on({ query_enabled: false, action_enabled: false, ai_fallback_enabled: true }))
    expect(resolveFeatureMode(s, 'query')).toBe('off')
    expect(resolveFeatureMode(s, 'action')).toBe('off')
    expect(resolveFeatureMode(s, 'aiFallback')).toBe('on')
  })
  it('알 수 없는 기능 이름은 off', () => {
    expect(resolveFeatureMode(parseCrazychatSettings(on()), 'nope' as never)).toBe('off')
  })
})

describe('사람 전용 주제 — 에이전트가 답하지 않는다', () => {
  it('정책 확정 7주제 + 기존 민감 카테고리 cs, 총 8개 코드가 모두 포함된다', () => {
    const all = ['damage', 'cs', 'lost', 'refund', 'cancel', 'legal', 'payment_error', 'personal_info']
    expect(HUMAN_ONLY_TOPICS).toHaveLength(all.length)
    for (const t of all) {
      expect(HUMAN_ONLY_TOPICS).toContain(t)
      expect(isHumanOnlyTopic(t)).toBe(true)
    }
  })
  it('대소문자·앞뒤 공백을 바꿔도 사람 전용으로 인식한다', () => {
    for (const t of ['DAMAGE', ' damage ', 'Refund', '\tlegal\n', 'Personal_Info', ' CS']) {
      expect(isHumanOnlyTopic(t), t).toBe(true)
    }
  })
  it('사람 전용 주제는 변형 표기로 허용 목록에 넣어도 제거된다', () => {
    const s = parseCrazychatSettings(on({ ai_allowed_categories: ['general', 'DAMAGE', ' refund ', 'Cs'] }))
    expect(s.aiAllowedCategories).toEqual(['general'])
  })
  it('일반 주제는 사람 전용이 아니다', () => {
    expect(isHumanOnlyTopic('general')).toBe(false)
    expect(isHumanOnlyTopic(null)).toBe(false)
  })
  it('AI 허용: 허용 목록에 있고 사람 전용이 아니며 AI 기능이 켜져 있어야 한다', () => {
    const s = parseCrazychatSettings(on())
    expect(isTopicAllowedForAi(s, 'general')).toBe(true)
    expect(isTopicAllowedForAi(s, 'reservation')).toBe(false) // 목록에 없음
    expect(isTopicAllowedForAi(s, 'damage')).toBe(false)      // 사람 전용
    expect(isTopicAllowedForAi(s, null)).toBe(false)
  })
  it('허용 목록이 비어 있으면 어떤 주제도 허용되지 않는다(기본 거부)', () => {
    const s = parseCrazychatSettings(on({ ai_allowed_categories: [] }))
    expect(isTopicAllowedForAi(s, 'general')).toBe(false)
  })
  it('마스터 OFF면 허용 목록에 있어도 AI 허용 안 됨', () => {
    const s = parseCrazychatSettings(on({ agent_enabled: false }))
    expect(isTopicAllowedForAi(s, 'general')).toBe(false)
  })
  it('AI 관찰 모드(observe)도 허용 판정은 통과 — 발송 여부는 호출부가 mode로 결정', () => {
    const s = parseCrazychatSettings(on({ ai_fallback_enabled: false, ai_fallback_observe: true }))
    expect(isTopicAllowedForAi(s, 'general')).toBe(true)
  })
})

describe('loadCrazychatSettings — 조회 실패 시 안전 폴백', () => {
  const mkAdmin = (result: unknown) => ({
    from: vi.fn(() => ({ select: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))) })) })) })),
  })
  it('정상 행을 읽는다', async () => {
    const s = await loadCrazychatSettings(mkAdmin({ data: on(), error: null }) as never)
    expect(s.agentEnabled).toBe(true)
  })
  it('올바른 테이블을 조회한다', async () => {
    const admin = mkAdmin({ data: on(), error: null })
    await loadCrazychatSettings(admin as never)
    expect(admin.from).toHaveBeenCalledWith('crazychat_settings')
  })
  it('DB 오류(테이블 없음 등)는 ALL_OFF', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await loadCrazychatSettings(mkAdmin({ data: null, error: { message: 'relation does not exist', code: '42P01' } }) as never)
    expect(s).toEqual(ALL_OFF)
    spy.mockRestore()
  })
  it('행이 없으면 ALL_OFF', async () => {
    expect(await loadCrazychatSettings(mkAdmin({ data: null, error: null }) as never)).toEqual(ALL_OFF)
  })
  it('예외(네트워크 장애)도 던지지 않고 ALL_OFF', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadCrazychatSettings(mkAdmin(new Error('network')) as never)).toEqual(ALL_OFF)
    spy.mockRestore()
  })
})
