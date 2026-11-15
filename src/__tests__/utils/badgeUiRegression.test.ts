import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 배지 CMS 화면 회귀 가드 — 2026-11-14 로컬 브라우저 실조작에서 발견·수정한 2건
 *  ① 쿠폰 선택 목록이 최신 200개만 읽어 오래된 쿠폰(Stage 활성 216개)을 고를 수 없었다
 *  ② 상품을 추가한 직후 이전 검색 목록이 다시 열려 아래 입력칸을 가렸다
 */
const root = process.cwd()
const server = readFileSync(path.join(root, 'src/routes/cms/promotion/ad/+page.server.ts'), 'utf8')
const rulePanel = readFileSync(path.join(root, 'src/lib/components/cms/badge/BadgeRulePanel.svelte'), 'utf8')

describe('배지 CMS 회귀 가드', () => {
  it('쿠폰 선택 목록 로드 한도가 200 이 아니다(쿠폰이 200개를 넘어도 모두 선택 가능)', () => {
    const m = server.match(/from\('coupons'\)[\s\S]*?\.limit\((\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(1000)
  })

  it('상품 추가 시 이전 검색 목록을 비운다', () => {
    const fn = rulePanel.slice(rulePanel.indexOf('function addProduct'))
    const body = fn.slice(0, fn.indexOf('\n  }\n'))
    expect(body).toContain('productOptions = []')
  })
})
