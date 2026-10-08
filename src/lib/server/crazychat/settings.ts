// settings.ts — 크레이지챗(채팅 에이전트) 기능 플래그·킬스위치 (서버 전용)
//
// 크레이지챗 = 기존 채팅 자동답변을 확장한 에이전트. 새 능력 3종(조회·접수·AI 답변)은 전부 이 설정으로 켜고 끈다.
//   · 기본값은 전부 OFF. 값이 이상하거나 설정 조회가 실패하면 항상 "꺼짐"으로 해석한다(안전 폴백).
//   · 마스터(agent_enabled)가 꺼져 있으면 개별 기능이 켜져 있어도 전부 정지(킬스위치).
//   · 기능별 모드: on(고객에게 발송) / observe(판정만 기록, 고객 미발송) / off.
//   · 기존 자동답변(auto_reply_settings.enabled·observe_mode)은 이 설정과 무관하게 그대로 동작한다.
// 저장소: crazychat_settings(서버 전용·RLS 정책 없음, Migration 662). 공개 읽기가 열려 있는 auto_reply_settings와 분리한 이유다.

export type CrazychatFeature = 'query' | 'action' | 'recommend' | 'aiFallback'
export type FeatureMode = 'off' | 'observe' | 'on'

export interface FeatureFlags {
  enabled: boolean
  observe: boolean
}

export interface CrazychatSettings {
  agentEnabled: boolean
  query: FeatureFlags
  action: FeatureFlags
  /** 상품 추천 대화카드(검색 기반, 대여 상품만) */
  recommend: FeatureFlags
  aiFallback: FeatureFlags
  /** AI가 답해도 되는 주제(빈 목록 = 어떤 주제도 허용 안 함). 사람 전용 주제는 목록에 있어도 제거된다. */
  aiAllowedCategories: readonly string[]
}

/**
 * 에이전트가 절대 답하지 않고 항상 사람에게 넘기는 주제(Stephen 확정, 2026-10-07).
 * 파손·분실·환불·예약 취소·법적 분쟁·결제 오류·개인정보 요청.
 * 'damage'·'cs'는 기존 빠른답변 민감 카테고리(SENSITIVE_CANNED_CATEGORIES)와 같은 코드다.
 */
export const HUMAN_ONLY_TOPICS: readonly string[] = Object.freeze([
  'damage', 'cs', 'lost', 'refund', 'cancel', 'legal', 'payment_error', 'personal_info',
])

const FEATURE_KEY: Record<CrazychatFeature, 'query' | 'action' | 'recommend' | 'aiFallback'> = {
  query: 'query',
  action: 'action',
  recommend: 'recommend',
  aiFallback: 'aiFallback',
}

const OFF_FLAGS: FeatureFlags = Object.freeze({ enabled: false, observe: false })

/** 전부 꺼진 기본 설정(동결) */
export const ALL_OFF: CrazychatSettings = Object.freeze({
  agentEnabled: false,
  query: OFF_FLAGS,
  action: OFF_FLAGS,
  recommend: OFF_FLAGS,
  aiFallback: OFF_FLAGS,
  aiAllowedCategories: Object.freeze<string[]>([]),
})

export function isHumanOnlyTopic(topic: string | null | undefined): boolean {
  return typeof topic === 'string' && HUMAN_ONLY_TOPICS.includes(topic.trim().toLowerCase())
}

/** boolean true만 켜짐 — 'true'·1·'yes' 같은 값은 모두 꺼짐 */
const isOn = (v: unknown): boolean => v === true

function parseCategories(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (!t || isHumanOnlyTopic(t) || out.includes(t)) continue
    out.push(t)
  }
  return out
}

/** DB 행(또는 아무 값) → 설정. 어떤 입력이 들어와도 던지지 않고, 해석 불가는 꺼짐으로 처리한다. */
export function parseCrazychatSettings(row: unknown): CrazychatSettings {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ALL_OFF
  const r = row as Record<string, unknown>
  return {
    agentEnabled: isOn(r.agent_enabled),
    query: { enabled: isOn(r.query_enabled), observe: isOn(r.query_observe) },
    action: { enabled: isOn(r.action_enabled), observe: isOn(r.action_observe) },
    recommend: { enabled: isOn(r.recommend_enabled), observe: isOn(r.recommend_observe) },
    aiFallback: { enabled: isOn(r.ai_fallback_enabled), observe: isOn(r.ai_fallback_observe) },
    aiAllowedCategories: parseCategories(r.ai_allowed_categories),
  }
}

/** 기능의 현재 동작 모드. 마스터가 꺼져 있으면 항상 off. enabled=true면 observe 값과 무관하게 on(기존 자동답변과 같은 규칙). */
export function resolveFeatureMode(settings: CrazychatSettings, feature: CrazychatFeature): FeatureMode {
  if (!settings.agentEnabled) return 'off'
  const key = FEATURE_KEY[feature]
  if (!key) return 'off'
  const flags = settings[key]
  if (flags.enabled) return 'on'
  if (flags.observe) return 'observe'
  return 'off'
}

/**
 * 이 주제를 AI가 다뤄도 되는지(발송 여부와 별개 — 관찰 모드에서도 같은 판정).
 * 기본 거부: AI 기능이 꺼져 있거나, 주제가 없거나, 사람 전용이거나, 허용 목록에 없으면 false.
 */
export function isTopicAllowedForAi(settings: CrazychatSettings, topic: string | null | undefined): boolean {
  if (resolveFeatureMode(settings, 'aiFallback') === 'off') return false
  if (typeof topic !== 'string') return false
  const t = topic.trim()
  if (!t || isHumanOnlyTopic(t)) return false
  return settings.aiAllowedCategories.includes(t)
}

interface SettingsReader {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> }
    }
  }
}

/** 설정을 읽는다. 테이블 없음·행 없음·DB 오류·예외 어느 쪽이든 ALL_OFF(고객 채팅 흐름을 막지 않는다). */
export async function loadCrazychatSettings(admin: SettingsReader): Promise<CrazychatSettings> {
  const BASE_COLS = 'agent_enabled, query_enabled, query_observe, action_enabled, action_observe, ai_fallback_enabled, ai_fallback_observe, ai_allowed_categories'
  try {
    let { data, error } = await admin.from('crazychat_settings').select(`${BASE_COLS}, recommend_enabled, recommend_observe`).limit(1).maybeSingle()
    if (error) {
      // 추천형 컬럼(Migration 669)이 아직 없는 DB에서도 조회·접수·AI는 계속 동작하도록 기본 컬럼만으로 한 번 더 읽는다(추천형은 꺼짐)
      ;({ data, error } = await admin.from('crazychat_settings').select(BASE_COLS).limit(1).maybeSingle())
    }
    if (error) {
      console.error('[crazychat] 설정 조회 실패(전부 꺼짐으로 처리):', error.message)
      return ALL_OFF
    }
    return parseCrazychatSettings(data)
  } catch (e) {
    console.error('[crazychat] 설정 조회 예외(전부 꺼짐으로 처리):', e instanceof Error ? e.message : String(e))
    return ALL_OFF
  }
}
