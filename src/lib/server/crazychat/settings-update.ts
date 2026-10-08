// settings-update.ts — 크레이지챗 설정 변경 요청의 검증·DB 값 변환·권한 판정(순수 로직, S5)
// 정책(Stephen 확정 2026-10-07): 마스터 ON·AI '켜짐'(고객 발송)은 슈퍼마스터 전용, 나머지 변경은 매니저 이상. 마스터 OFF는 언제나 허용(비상 정지).
// 단계 표현: off(꺼짐) / observe(관찰 — 판정·기록만, 고객 발송 없음) / on(켜짐).

import { HUMAN_ONLY_TOPICS } from './settings'

export type FeatureLevel = 'off' | 'observe' | 'on'
export type SettingsFeature = 'query' | 'action' | 'recommend' | 'ai_fallback'
export const FEATURES: readonly SettingsFeature[] = ['query', 'action', 'recommend', 'ai_fallback']
const LEVELS: readonly FeatureLevel[] = ['off', 'observe', 'on']

/** crazychat_settings 행(변경 판정에 쓰는 열) */
export interface SettingsRow {
  agent_enabled: boolean
  query_enabled: boolean
  query_observe: boolean
  action_enabled: boolean
  action_observe: boolean
  recommend_enabled: boolean
  recommend_observe: boolean
  ai_fallback_enabled: boolean
  ai_fallback_observe: boolean
  ai_allowed_categories: string[]
}

export interface SettingsChange {
  agent_enabled?: boolean
  query?: FeatureLevel
  action?: FeatureLevel
  recommend?: FeatureLevel
  ai_fallback?: FeatureLevel
  ai_allowed_categories?: string[]
}

export interface SettingsLevels {
  agent_enabled: boolean
  query: FeatureLevel
  action: FeatureLevel
  recommend: FeatureLevel
  ai_fallback: FeatureLevel
  ai_allowed_categories: string[]
}

/** DB 열 → 단계(enabled 우선: enabled면 on, 아니면 observe면 observe) */
export function levelOf(enabled: boolean, observe: boolean): FeatureLevel {
  if (enabled === true) return 'on'
  if (observe === true) return 'observe'
  return 'off'
}

export function rowToLevels(row: SettingsRow): SettingsLevels {
  return {
    agent_enabled: row.agent_enabled === true,
    query: levelOf(row.query_enabled, row.query_observe),
    action: levelOf(row.action_enabled, row.action_observe),
    recommend: levelOf(row.recommend_enabled, row.recommend_observe),
    ai_fallback: levelOf(row.ai_fallback_enabled, row.ai_fallback_observe),
    ai_allowed_categories: [...row.ai_allowed_categories],
  }
}

const KEYS = new Set<string>(['agent_enabled', 'query', 'action', 'recommend', 'ai_fallback'])

export type ParseResult = { ok: true; change: SettingsChange } | { ok: false; error: string }

/** 요청 본문 검증 — 모르는 키·잘못된 값·빈 요청은 거부 */
export function parseSettingsChange(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: '요청 형식이 올바르지 않습니다.' }
  const o = body as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length === 0) return { ok: false, error: '변경할 내용이 없습니다.' }
  if (keys.includes('ai_allowed_categories')) return { ok: false, error: 'AI가 답해도 되는 분류는 빠른답변 "분류 설정"에서 바꿉니다.' }
  for (const k of keys) if (!KEYS.has(k)) return { ok: false, error: `알 수 없는 항목입니다: ${k}` }
  const change: SettingsChange = {}
  if ('agent_enabled' in o) {
    if (typeof o.agent_enabled !== 'boolean') return { ok: false, error: '마스터 스위치 값이 올바르지 않습니다.' }
    change.agent_enabled = o.agent_enabled
  }
  for (const f of FEATURES) {
    if (f in o) {
      const v = o[f]
      if (typeof v !== 'string' || !LEVELS.includes(v as FeatureLevel)) return { ok: false, error: `${f} 단계 값이 올바르지 않습니다.` }
      change[f] = v as FeatureLevel
    }
  }
  return { ok: true, change }
}

/** 변경 적용 후의 단계 */
export function applyChange(current: SettingsLevels, change: SettingsChange): SettingsLevels {
  return {
    agent_enabled: change.agent_enabled ?? current.agent_enabled,
    query: change.query ?? current.query,
    action: change.action ?? current.action,
    recommend: change.recommend ?? current.recommend,
    ai_fallback: change.ai_fallback ?? current.ai_fallback,
    ai_allowed_categories: change.ai_allowed_categories ?? current.ai_allowed_categories,
  }
}

/** 변경이 실제로 값을 바꾸는지 */
export function isNoop(before: SettingsLevels, after: SettingsLevels): boolean {
  return before.agent_enabled === after.agent_enabled && before.query === after.query && before.action === after.action && before.recommend === after.recommend &&
    before.ai_fallback === after.ai_fallback &&
    before.ai_allowed_categories.length === after.ai_allowed_categories.length &&
    before.ai_allowed_categories.every((c) => after.ai_allowed_categories.includes(c))
}

/** 슈퍼마스터 전용 변경인가: 마스터를 켜는 것, AI를 '켜짐'으로 두거나 '켜짐' 상태에서 허용 분류를 바꾸는 것 */
export function requiresSuperadmin(before: SettingsLevels, after: SettingsLevels): boolean {
  if (!before.agent_enabled && after.agent_enabled) return true
  if (after.ai_fallback === 'on') {
    if (before.ai_fallback !== 'on') return true
    const same = before.ai_allowed_categories.length === after.ai_allowed_categories.length &&
      before.ai_allowed_categories.every((c) => after.ai_allowed_categories.includes(c))
    if (!same) return true
  }
  return false
}

/** 단계 → DB 열 변환 (on = enabled, observe = observe만) */
export function levelsToColumns(l: SettingsLevels): SettingsRow {
  const pair = (lv: FeatureLevel) => ({ enabled: lv === 'on', observe: lv === 'observe' })
  const q = pair(l.query), a = pair(l.action), rc = pair(l.recommend), ai = pair(l.ai_fallback)
  return {
    agent_enabled: l.agent_enabled,
    query_enabled: q.enabled, query_observe: q.observe,
    action_enabled: a.enabled, action_observe: a.observe,
    recommend_enabled: rc.enabled, recommend_observe: rc.observe,
    ai_fallback_enabled: ai.enabled, ai_fallback_observe: ai.observe,
    ai_allowed_categories: l.ai_allowed_categories,
  }
}

/** AI를 '켜짐'으로 바꾸기 전 화면에 보여줄 경고(서버는 막지 않는다 — 추천 기준) */
export const AI_READY_MIN_REVIEWED = 50
export const AI_READY_MIN_ACCURACY = 0.9

export { HUMAN_ONLY_TOPICS }
