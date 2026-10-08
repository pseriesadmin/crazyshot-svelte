/**
 * TDD: 크레이지챗 "AI가 답해도 되는 분류"는 빠른답변 분류 설정(canned_response_categories.ai_allowed)이 정본이다 (2026-10-08).
 * 분류 표를 못 읽거나 ai_allowed 컬럼이 없으면(Migration #682 적용 전) 기존 설정 컬럼 값으로 폴백한다.
 */
import { describe, it, expect } from 'vitest'
import { loadCrazychatSettings } from '$lib/server/crazychat/settings'

const settingsRow = { agent_enabled: true, ai_fallback_enabled: true, ai_allowed_categories: ['reservation', 'return'] }

function fake(opts: { cats?: { data: unknown; error: { message: string } | null } | 'throw' }) {
  return {
    from: (table: string) => ({
      select: (_cols: string) => {
        if (table === 'canned_response_categories') {
          if (opts.cats === 'throw') throw new Error('boom')
          return Promise.resolve(opts.cats ?? { data: null, error: { message: 'no table' } })
        }
        return { limit: () => ({ maybeSingle: () => Promise.resolve({ data: settingsRow, error: null }) }) }
      },
    }),
  }
}

describe('loadCrazychatSettings — 분류 표에서 AI 허용 분류 도출', () => {
  it('분류 표의 ai_allowed(활성·비민감)가 설정 컬럼보다 우선한다', async () => {
    const s = await loadCrazychatSettings(fake({ cats: { error: null, data: [
      { value: 'payment', is_active: true, human_only: false, ai_allowed: true, sort_order: 2 },
      { value: 'reservation', is_active: true, human_only: false, ai_allowed: false, sort_order: 3 },
      { value: 'c1', is_active: true, human_only: false, ai_allowed: true, sort_order: 7 },
      { value: 'c2', is_active: false, human_only: false, ai_allowed: true, sort_order: 8 },
      { value: 'damage', is_active: true, human_only: true, ai_allowed: true, sort_order: 4 },
    ] } }) as never)
    expect([...s.aiAllowedCategories]).toEqual(['payment', 'c1'])
  })
  it('분류 표를 못 읽으면 기존 설정 컬럼 값을 쓴다', async () => {
    const s = await loadCrazychatSettings(fake({ cats: { data: null, error: { message: 'x' } } }) as never)
    expect([...s.aiAllowedCategories]).toEqual(['reservation', 'return'])
    const t = await loadCrazychatSettings(fake({ cats: 'throw' }) as never)
    expect([...t.aiAllowedCategories]).toEqual(['reservation', 'return'])
  })
  it('ai_allowed 컬럼이 없는 표(적용 전)면 기존 설정 컬럼 값을 쓴다', async () => {
    const s = await loadCrazychatSettings(fake({ cats: { error: null, data: [{ value: 'return', is_active: true, human_only: false }] } }) as never)
    expect([...s.aiAllowedCategories]).toEqual(['reservation', 'return'])
  })
  it('표는 읽혔지만 허용 분류가 하나도 없으면 빈 목록(관리자가 모두 끈 상태)', async () => {
    const s = await loadCrazychatSettings(fake({ cats: { error: null, data: [{ value: 'return', is_active: true, human_only: false, ai_allowed: false }] } }) as never)
    expect([...s.aiAllowedCategories]).toEqual([])
  })
})
