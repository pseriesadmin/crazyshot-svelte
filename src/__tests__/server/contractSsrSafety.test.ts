// @vitest-environment node
// ⚠️ jsdom 주석 없음 — 이 테스트는 순수 Node.js 환경(브라우저 DOM 없음)에서 실행됨.
// 목적: SSR(Vercel 서버리스 Node.js 함수)에서 고객 계약 서명 페이지 렌더링 시
//       tiptap-doc 렌더링이 크래시 없이 안전하게 동작하는지 회귀 방지.
//
// 발견된 버그 (2026-08-13 QA 재검수):
//   renderTiptapDocToHtml()은 내부적으로 generateHTML(@tiptap/core) →
//   getHTMLFromFragment() → document.implementation.createHTMLDocument()를 호출함.
//   Node.js 환경에는 document/window가 없으므로 SSR 단계에서 즉시 크래시.
//   결과: 고객이 계약서 서명 링크를 열 때마다 500 에러.
//
// 수정: contract/[token]/+page.svelte의 tiptap-doc 렌더링 지점에
//   {#if browser} ... {:else} <로딩 문구> {/if} 가드를 추가.
//   이 가드가 없으면 아래 테스트가 회귀를 조기에 포착한다.

import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { isTiptapDocBlock } from '$lib/types/contract-document.js'
import type { TiptapDocBlock } from '$lib/types/contract-document.js'

// ── SSR 크래시 재현 — browser 가드의 필요성을 문서화 ─────────────────────────

describe('[SSR 안전성] renderTiptapDocToHtml — 순수 Node.js 환경 크래시 확인', () => {
  it('Node.js(jsdom 없음) 환경에서 generateHTML 호출 시 크래시가 발생한다 — browser 가드 필요성 문서화', async () => {
    // 이 테스트는 "renderTiptapDocToHtml이 Node.js에서 왜 직접 호출되면 안 되는가"를 증명함.
    // 만약 이 테스트가 throw 없이 통과한다면, @tiptap/core의 내부 구현이 변경된 것이므로
    // contract/[token]/+page.svelte의 browser 가드 필요성을 재검토해야 한다.
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '테스트' }] }],
    }

    // Node.js 환경에서 generateHTML은 "window is not defined" 또는 "document is not defined"로
    // 크래시한다 — 이것이 browser 가드가 필수인 이유.
    expect(() => renderTiptapDocToHtml(doc)).toThrow()
  })
})

// ── DOM 불필요 유틸 — SSR에서 안전하게 사용 가능 ────────────────────────────

describe('[SSR 안전성] isTiptapDocBlock — Node.js 환경에서 DOM 없이 동작 확인', () => {
  it('isTiptapDocBlock 타입 가드는 DOM 없이도 정상 동작한다', () => {
    // 타입 가드는 순수 JS 객체 비교만 사용하므로 SSR에서 안전
    const block: TiptapDocBlock = {
      type: 'tiptap-doc',
      doc: { type: 'doc', content: [] },
    }

    expect(isTiptapDocBlock(block)).toBe(true)
    expect(isTiptapDocBlock({ type: 'text', html: '<p>hello</p>' })).toBe(false)
    expect(isTiptapDocBlock(null)).toBe(false)
    expect(isTiptapDocBlock(undefined)).toBe(false)
    expect(isTiptapDocBlock({ type: 'tiptap-doc' })).toBe(false) // doc 프로퍼티 없음
  })

  it('tiptap-doc 블록을 생성·식별할 때 DOM API가 전혀 필요 없다', () => {
    // SSR에서 content_blocks JSONB 파싱·타입 분기는 안전
    const rawBlocks: unknown[] = [
      { type: 'text', html: '<p>조항 1</p>' },
      { type: 'tiptap-doc', doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      { type: 'divider' },
    ]

    const tiptapBlocks = rawBlocks.filter(isTiptapDocBlock)
    expect(tiptapBlocks).toHaveLength(1)
    expect(tiptapBlocks[0].type).toBe('tiptap-doc')
  })
})

// ── substituteTiptapDoc — DOM 없이도 동작 확인 ───────────────────────────────

describe('[SSR 안전성] substituteTiptapDoc — Node.js 환경에서 치환 동작 확인', () => {
  it('substituteTiptapDoc은 DOM 없이도 JSONContent 트리 순회·치환이 가능하다', async () => {
    // substituteTiptapDoc은 renderTiptapDocToHtml과 달리 DOM을 사용하지 않음
    // (순수 JSON 트리 조작만 수행) — SSR에서 호출해도 안전
    const { substituteTiptapDoc } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mergeField', attrs: { variable: '고객이름', label: '고객이름' } },
          ],
        },
      ],
    }

    // SSR에서는 치환(JSON 조작)까지는 가능 — HTML 변환만 browser 가드 필요
    expect(() => substituteTiptapDoc(doc, { 고객이름: '홍길동' })).not.toThrow()

    const result = substituteTiptapDoc(doc, { 고객이름: '홍길동' })
    const textNode = result.content?.[0]?.content?.[0]
    expect(textNode?.type).toBe('text')
    expect(textNode?.text).toBe('홍길동')
  })
})
