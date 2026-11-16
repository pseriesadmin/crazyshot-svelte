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
  it('글자 크기 — PC(≥768px) = 기준×0.5+3, 모바일 = PC−2 (카드 PC 14·모바일 12, 상세 제목 PC 16·모바일 14)', () => {
    const chip = read('src/lib/components/cms/badge/BadgeChip.svelte')
    expect(chip).toContain('const fontPc = $derived(Math.round(size * 0.5) + 3)')
    expect(chip).toContain('const fontMobile = $derived(fontPc - 2)')
    expect(chip).toContain('--bar-fs-m:{fontMobile}px;--bar-fs-pc:{fontPc}px')
    expect(chip).toContain('font-size: var(--bar-fs-m);')
    expect(chip).toMatch(/@media \(min-width: 768px\) \{\s*\.badge-bar \{ font-size: var\(--bar-fs-pc\); \}/)
    expect(chip).not.toMatch(/font-size:\{Math\.round/)
    // 기준 크기별 결과: 카드 22 → PC 14·모바일 12, 상세 제목 26 → PC 16·모바일 14
    const pc = (size: number) => Math.round(size * 0.5) + 3
    expect([pc(22), pc(22) - 2, pc(26), pc(26) - 2]).toEqual([14, 12, 16, 14])
  })
  it('이미지형은 파일 크기·비율과 무관하게 정사각 칸(size×1.5)을 가득 채운다(object-fit: cover, 가운데 기준)', () => {
    const chip = read('src/lib/components/cms/badge/BadgeChip.svelte')
    expect(chip).toMatch(/\.badge-img \{[^}]*object-fit: cover;[^}]*object-position: center;/)
    expect(chip).not.toContain('object-fit: contain')
    expect(chip).toContain('const box = $derived(Math.round(size * 1.5))')
    expect(chip).toContain('style="width:{box}px;height:{box}px"')
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
