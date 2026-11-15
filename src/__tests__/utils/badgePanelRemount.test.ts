import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 배지 패널 — 항목을 바꾸면 패널이 새로 마운트되어야 한다(core-rules: $state(prop) 초기화 금지 → 부모 {#key}).
 * 패널은 마운트 시 1회 prop 으로 초기화하므로 {#key} 가 빠지면 다른 항목을 열어도 이전 값이 남는다.
 */
const dir = path.resolve(process.cwd(), 'src/lib/components/cms/badge')
const tab = readFileSync(path.join(dir, 'BadgeTab.svelte'), 'utf8')

describe('BadgeTab — 패널 {#key} 재마운트', () => {
  it('규칙 패널·템플릿 패널 모두 {#key} 안에서 렌더된다', () => {
    const keyAt = tab.indexOf('{#key')
    expect(keyAt).toBeGreaterThan(-1)
    const endKey = tab.indexOf('{/key}', keyAt)
    const block = tab.slice(keyAt, endKey)
    expect(block).toContain('<BadgeRulePanel')
    expect(block).toContain('<BadgeTemplatePanel')
  })

  it('key 값에 탭(mode)과 선택 id 가 모두 들어 있다', () => {
    expect(tab).toMatch(/\{#key `\$\{mode\}:\$\{selectedId\}:\$\{panelVersion\}`\}/)
  })

  it('패널은 prop 으로 $state 를 초기화하는 대신 이 구조에 의존한다(주석으로 명시)', () => {
    for (const f of ['BadgeRulePanel.svelte', 'BadgeTemplatePanel.svelte']) {
      expect(readFileSync(path.join(dir, f), 'utf8')).toMatch(/\{#key\}|\{#key/)
    }
  })

  it('저장해도 패널을 닫지 않는다(저장된 항목으로 다시 열고, 삭제만 닫는다)', () => {
    const after = tab.slice(tab.indexOf('async function afterSaved'), tab.indexOf('async function onReorder'))
    expect(after).toContain('await invalidateAll()')
    expect(after).toMatch(/if \(savedId\) \{\s*selectedId = savedId\s*panelVersion \+= 1/)
    expect(after).toMatch(/\} else \{\s*selectedId = null/)
    for (const f of ['BadgeRulePanel.svelte', 'BadgeTemplatePanel.svelte']) {
      const src = readFileSync(path.join(dir, f), 'utf8')
      expect(src).toMatch(/onsaved\(r\.id \?\? (rule|template)\?\.id\)/)
      expect(src).toContain('onsuccess={() => onsaved()}')
    }
  })
})
