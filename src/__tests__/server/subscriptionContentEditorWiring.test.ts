import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 구독 설명(CMS) 새 에디터 적용 배선 + CMS 디자인 토큰 규정(cms-uiux.md) 점검 (2026-10-06)
 */
const read = (p: string): string => readFileSync(p, 'utf-8')

describe('SubscriptionDetailPanel — RichContentEditor 적용', () => {
  const s = read('src/lib/components/cms/subscription/SubscriptionDetailPanel.svelte')
  it('구 CmsContentEditor 대신 새 에디터(cms 변형)를 쓴다', () => {
    expect(s).not.toContain('CmsContentEditor')
    expect(s).toContain("import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'")
    expect(s).toMatch(/<RichContentEditor[\s\S]*variant="cms"/)
  })
  it('서버값 재동기화는 {#key} 재마운트(새 에디터는 prop 변경을 따라가지 않음)이고, 키 증가는 untrack으로 무한 루프를 막는다', () => {
    expect(s).toContain('{#key contentEditorKey}')
    expect(s).toMatch(/untrack\(\(\) => \{ contentEditorKey \+= 1 \}\)/)
  })
  it('저장 직전 flush()로 대기 중인 편집을 반영하고 누락 점검을 한다', () => {
    expect(s).toContain('contentEditorRef?.flush()')
    expect(s).toMatch(/flushed\s*&&\s*!flushed\.ok/)
    expect(s).toContain('fd.set(\'content_blocks\', JSON.stringify(blocksToSave))')
  })
  it('저장되지 않는 키워드 입력란은 숨긴다', () => {
    expect(s).toContain('showKeywords={false}')
  })
})

describe('RichContentEditor — CMS 토큰 규정(허용 목록 밖 rgba·hex 하드코딩 금지)', () => {
  const s = read('src/lib/components/editor/RichContentEditor.svelte')
  const style = s.slice(s.indexOf('<style>'))
  it('스타일에 rgba() 하드코딩이 없다(토큰 기반 color-mix 사용)', () => {
    expect(style).not.toMatch(/rgba\(/)
    expect(style).toContain('color-mix(in srgb, var(--cs-purple)')
  })
  it('CMS 변형 캔버스는 --text-m-* 모바일 토큰을 쓰지 않는다', () => {
    expect(style).toMatch(/\.rc-root\[data-variant='cms'\] \.rc-host :global\(\.rc-canvas\)\s*\{[^}]*font: inherit/)
  })
})
