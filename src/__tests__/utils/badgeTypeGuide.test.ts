import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isPngBytes, validateBadgePng } from '$lib/server/validateBadgePng'

/** 배지타입 패널 — 형태 버튼 아래 가이드 문장 + 그 문장대로의 실제 동작(PNG·SVG 등록, 텍스트바 10자) (2026-11-16, Stephen 지시) */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')
const panel = read('src/lib/components/cms/badge/BadgeTemplatePanel.svelte')
const api = read('src/routes/api/cms/badges/icon/+server.ts')
const sql = read('supabase/migrations/20261116140000_832_badge_png_and_text10.sql')

/** 최소 PNG: 시그니처 + IHDR(가로·세로) — 파일 머리 확인용 */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const v = new DataView(b.buffer)
  v.setUint32(16, width)
  v.setUint32(20, height)
  return b
}

describe('배지타입 패널 — 가이드 문장', () => {
  it('형태 버튼 바로 아래(같은 값 칸 안)에 지정 문장을 그대로 보여 준다', () => {
    const guide = '원형이미지 타입으로 등록 가능한 이미지 파일 포맷은 PNG, SVG 이며, SVG를 추천합니다. 텍스트바 타입은 최대 10자 이내 입력 가능하며 6자 내외 입력을 추천합니다.'
    expect(panel).toContain(`<p class="type-guide">${guide}</p>`)
    expect(panel.indexOf('class="pill-row"')).toBeLessThan(panel.indexOf('class="type-guide"'))
    expect(panel).toMatch(/\.type-guide \{ margin: 6px 0 0;/)
  })
})

describe('문장대로의 실제 동작', () => {
  it('이미지 선택 창이 SVG·PNG 를 받고, 안내 문구는 SVG 전용이 아니다', () => {
    expect(panel).toContain('accept="image/svg+xml,.svg,image/png,.png"')
    expect(panel).not.toContain('SVG 가져오기')
  })
  it('서버는 파일 머리로 종류를 판별해 PNG 는 검증 후 원본, SVG 는 정화본을 저장한다', () => {
    expect(api).toContain('isPngBytes(bytes)')
    expect(api).toContain('validateBadgePng(bytes)')
    expect(api).toContain('sanitizeBadgeSvg(')
    expect(api).toContain('.${ext}')
    expect(api).toContain('(svg|png)')
  })
  it('DB: 버킷에 PNG 허용 + 이미지 주소 .svg|.png', () => {
    expect(sql).toContain("ARRAY['image/svg+xml', 'image/png']")
    expect(sql).toContain('\\.(svg|png)$')
  })
})

describe('validateBadgePng', () => {
  it('정상 PNG 머리는 통과한다', () => {
    expect(isPngBytes(png(64, 64))).toBe(true)
    expect(validateBadgePng(png(64, 64))).toEqual({ ok: true, width: 64, height: 64 })
  })
  it('PNG 가 아니거나 머리가 깨졌거나 크기가 0·너무 크면 거절한다', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(isPngBytes(svg)).toBe(false)
    expect(validateBadgePng(svg).ok).toBe(false)
    expect(validateBadgePng(new Uint8Array(10)).ok).toBe(false)
    const noIhdr = png(10, 10)
    noIhdr[12] = 0x58
    expect(validateBadgePng(noIhdr).ok).toBe(false)
    expect(validateBadgePng(png(0, 10)).ok).toBe(false)
    expect(validateBadgePng(png(1025, 10)).ok).toBe(false)
    expect(validateBadgePng(png(1024, 1024)).ok).toBe(true)
  })
})
