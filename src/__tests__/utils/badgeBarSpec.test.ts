import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** 바(텍스트)형 배지 규격 — 문구 최대 10자(화면 입력·DB 제약·저장 함수 동일, #832 에서 8→10), 알약형 라운드, 높이 = 기준 크기 × 1.1 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')

describe('바형 배지 규격', () => {
  it('문구 입력 최대 10자', () => {
    expect(read('src/lib/components/cms/badge/BadgeTemplatePanel.svelte')).toContain('id="bt-text" class="il-input" maxlength="10"')
  })
  it('DB 제약·저장 함수도 10자(마이그레이션 #832)', () => {
    const sql = read('supabase/migrations/20261116140000_832_badge_png_and_text10.sql')
    expect(sql).toContain('char_length(text) BETWEEN 1 AND 10')
    expect(sql).toContain('char_length(btrim(p_text)) NOT BETWEEN 1 AND 10')
    expect(sql).toContain('문구는 1~10자로 입력해 주세요')
    expect(sql).not.toMatch(/BETWEEN 1 AND 8\b/)
  })
  it('알약형 라운드 + 높이 10% 확대', () => {
    const chip = read('src/lib/components/cms/badge/BadgeChip.svelte')
    expect(chip).toMatch(/border-radius:\s*9999px/)
    expect(chip).toContain('Math.round(size * 1.1)')
    expect(chip).toContain('height:{barH}px')
    expect(chip).toContain('Math.round(size * 0.6)')
    expect(chip).toContain('padding:0 {padX}px')
  })
})
