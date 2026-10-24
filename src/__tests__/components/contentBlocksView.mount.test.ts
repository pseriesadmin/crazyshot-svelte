// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { readFileSync } from 'node:fs'
import ContentBlocksView from '$lib/components/common/ContentBlocksView.svelte'
import type { ContentBlock } from '$lib/types/content-editor'

/** 콘텐츠 블록 읽기 전용 렌더러(공통 푸터 '팀' 모달 등) 실제 렌더 확인 (2026-10-24) — 실행: npm run test:component */
let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) unmount(cmp)
  cmp = null
  document.body.innerHTML = ''
})
function render(blocks: ContentBlock[]) {
  cmp = mount(ContentBlocksView, { target: document.body, props: { blocks } })
  flushSync()
  return document.body
}

describe('ContentBlocksView', () => {
  it('텍스트(서식 HTML)·이미지·구분선·링크를 순서대로 그린다', () => {
    const body = render([
      { type: 'text', html: '<h2>팀 소개</h2><p>안녕하세요</p>' },
      { type: 'image', layout: 'individual', images: [{ url: 'https://cdn.example/a.png', alt: '대표 사진' }] },
      { type: 'divider' },
      { type: 'link-entry', url: 'https://example.com/team', text: '팀 페이지' },
    ])
    expect(body.querySelector('h2')?.textContent).toBe('팀 소개')
    const img = body.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cdn.example/a.png')
    expect(img.alt).toBe('대표 사진')
    expect(body.querySelector('hr')).not.toBeNull()
    const a = body.querySelector('a') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('https://example.com/team')
    expect(a.rel).toContain('noopener')
    expect(a.target).toBe('_blank')
  })

  it('이미지 묶음에서 isHead 표시 이미지는 제외한다', () => {
    const body = render([{ type: 'image', layout: 'collage', images: [{ url: 'https://x/h.png', alt: 'h', isHead: true }, { url: 'https://x/b.png', alt: 'b' }] }])
    expect(Array.from(body.querySelectorAll('img')).map((i) => i.getAttribute('src'))).toEqual(['https://x/b.png'])
  })

  it('유튜브는 안전한 영상 ID일 때만 임베드한다', () => {
    const ok = render([{ type: 'youtube', videoId: 'dQw4w9WgXcQ', url: '' }])
    expect(ok.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
    unmount(cmp as Record<string, unknown>); cmp = null; document.body.innerHTML = ''
    const bad = render([{ type: 'youtube', videoId: '"><script>', url: '' }])
    expect(bad.querySelector('iframe')).toBeNull()
  })

  it('블록이 없으면 아무것도 그리지 않는다', () => {
    const body = render([])
    expect(body.querySelector('.cbv')?.children.length ?? 0).toBe(0)
  })

  it('구분선은 실제로 보이는 높이·색을 가진다(0px 선이 되지 않게)', () => {
    const src = readFileSync('src/lib/components/common/ContentBlocksView.svelte', 'utf-8')
    const rule = src.match(/\.cbv-divider\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/height:\s*1px/)
    expect(rule).toMatch(/background:\s*var\(--cs-lilac\)/)
  })
})
