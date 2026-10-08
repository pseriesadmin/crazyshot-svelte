// replyPipeline.ts — 자동답변 스위치 전체 현황(읽기 전용 요약). 고객 메시지가 거치는 순서대로 각 단계의 실제 동작 상태를 한눈에 보여준다.
//   순서: 빠른답변 → (상담원이 최근 30분 내 답했다면 에이전트 생략) → 조회형 → 접수형 → 추천형 → AI 답변 → 대기 안내/상담원
import type { SettingsLevels } from '$lib/server/crazychat/settings-update'

export type StepState = 'on' | 'observe' | 'off' | 'stopped' | 'unknown'
export interface PipelineStep { key: 'quick' | 'query' | 'action' | 'recommend' | 'ai_fallback'; label: string; state: StepState; note: string }

const STATE_NOTE: Record<'on' | 'observe' | 'off', string> = {
  on: '고객에게 발송합니다.',
  observe: '판정만 기록하고 고객에게는 보내지 않습니다.',
  off: '동작하지 않습니다.',
}

export function buildReplyPipeline(
  quick: { enabled: boolean; observe_mode: boolean } | null,
  settings: Pick<SettingsLevels, 'agent_enabled' | 'query' | 'action' | 'recommend' | 'ai_fallback'> | null,
  aiAllowedCount = 0,
): PipelineStep[] {
  const steps: PipelineStep[] = []
  if (!quick) steps.push({ key: 'quick', label: '빠른답변', state: 'unknown', note: '상태를 불러오지 못했습니다.' })
  else {
    const state = quick.enabled ? 'on' : quick.observe_mode ? 'observe' : 'off'
    steps.push({ key: 'quick', label: '빠른답변', state, note: STATE_NOTE[state] })
  }
  const feats: { key: 'query' | 'action' | 'recommend' | 'ai_fallback'; label: string }[] = [
    { key: 'query', label: '조회형' }, { key: 'action', label: '접수형' }, { key: 'recommend', label: '추천형' }, { key: 'ai_fallback', label: 'AI 답변' },
  ]
  for (const f of feats) {
    if (!settings) { steps.push({ ...f, state: 'unknown', note: '상태를 불러오지 못했습니다.' }); continue }
    const level = settings[f.key]
    if (level === 'off') { steps.push({ ...f, state: 'off', note: STATE_NOTE.off }); continue }
    if (!settings.agent_enabled) { steps.push({ ...f, state: 'stopped', note: `설정은 ${level === 'on' ? '켜짐' : '관찰'}이지만 크레이지챗 마스터가 꺼져 있어 정지 중입니다.` }); continue }
    const extra = f.key === 'ai_fallback' ? ` 허용 분류 ${aiAllowedCount}개.` : ''
    steps.push({ ...f, state: level, note: STATE_NOTE[level] + extra })
  }
  return steps
}
