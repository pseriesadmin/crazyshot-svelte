import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** 바(텍스트)형 배지 규격 — 문구 최대 8자(화면 입력·DB 제약·저장 함수 동일), 알약형 라운드, 높이 = 기준 크기 × 1.1 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')

describe('바형 배지 규격', () => {
  it('문구 입력 최대 8자', () => {
    expect(read('src/lib/components/cms/badge/BadgeTemplatePanel.svelte')).toContain('id="bt-text" class="il-input" maxlength="8"')
  })
  it('DB 제약·저장 함수도 8자(마이그레이션 #828)', () => {
    const sql = read('supabase/migrations/20261114030000_828_product_badges.sql')
    expect(sql).toContain('char_length(text) BETWEEN 1 AND 8')
    expect(sql).toContain('char_length(btrim(p_text)) NOT BETWEEN 1 AND 8')
    expect(sql).toContain('문구는 1~8자로 입력해 주세요')
    expect(sql).not.toMatch(/BETWEEN 1 AND 12/)
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
