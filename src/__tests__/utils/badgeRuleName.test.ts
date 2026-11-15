import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/** 배지목록(노출 설정) 명칭 입력 — 패널 입력칸·저장 전달·목록 카드 표시·서버 검증 */
const panel = readFileSync('src/lib/components/cms/badge/BadgeRulePanel.svelte', 'utf-8')
const tab = readFileSync('src/lib/components/cms/badge/BadgeTab.svelte', 'utf-8')
const server = readFileSync('src/routes/cms/promotion/ad/+page.server.ts', 'utf-8')
const sql = readFileSync('supabase/migrations/20261114030000_828_product_badges.sql', 'utf-8')

describe('배지목록 명칭', () => {
  it('패널에 명칭 입력칸(40자)이 있고 저장 값으로 보낸다', () => {
    expect(panel).toMatch(/for="badge-name"[^>]*>목록이름</)
    expect(panel).toMatch(/id="badge-name"[^>]*maxlength="40"/)
    expect(panel).toContain('name: name.trim()')
  })
  it('목록 카드는 명칭을 보여 준다', () => {
    expect(tab).toContain('{r.name}')
  })
  it('서버·DB가 1~40자를 강제한다', () => {
    expect(server).toContain("p_name: name")
    expect(sql).toMatch(/cms_save_product_badge[\s\S]*p_name\s+text/)
    expect(sql).toMatch(/product_badges[\s\S]*name\s+text NOT NULL CHECK \(char_length\(name\) BETWEEN 1 AND 40\)/)
  })
})
