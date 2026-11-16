import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 배지 상세 패널(새 배지·배지목록) — 내용이 길어지면 바깥 .detail-pane(max-height + overflow-y: auto)이 스크롤한다.
 * 패널(.detail-panel)이 flex 항목으로 줄어들며 overflow:hidden 으로 잘리지 않도록 flex-shrink: 0 이어야 한다(2026-11-16).
 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')
const tab = read('src/lib/components/cms/badge/BadgeTab.svelte')

describe('배지 상세 패널 스크롤', () => {
  it('detail-pane 이 화면 높이를 넘으면 세로 스크롤한다', () => {
    const css = tab.slice(tab.indexOf('.detail-pane {'))
    const rule = css.slice(0, css.indexOf('}'))
    expect(rule).toContain('max-height: calc(100vh - 126px)')
    expect(rule).toContain('overflow-y: auto')
  })
  it.each(['BadgeTemplatePanel', 'BadgeRulePanel'])('%s 의 .detail-panel 은 줄어들지 않는다(flex-shrink: 0)', (name) => {
    const src = read(`src/lib/components/cms/badge/${name}.svelte`)
    const line = src.split('\n').find((l) => l.includes('.detail-panel {')) ?? ''
    expect(line).toContain('flex-shrink: 0')
    expect(line).toContain('overflow: hidden')
  })
})
