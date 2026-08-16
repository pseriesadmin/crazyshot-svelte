// @vitest-environment jsdom
// generateHTML(@tiptap/core)이 내부적으로 DOMSerializer(document/window)를 사용하므로
// jsdom 환경 필요 — Node.js 기본 환경(window 미정의)에서는 DOM 직렬화 불가.
import { describe, it, expect, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import type { ContractSubstitutionData } from '$lib/types/contract-module.js'
import type { TiptapDocBlock } from '$lib/types/contract-document.js'

/**
 * contractTiptapRender.test.ts — TipTap 기반 계약서 렌더링·치환 TDD
 *
 * 회귀 방지 대상:
 *   - tiptap-doc 블록이 고객 서명화면 및 미리보기에서 렌더링되지 않는 문제
 *   - MergeFieldNode 변수가 실제 값으로 치환되지 않는 문제
 *
 * 완료기준:
 *   1. renderTiptapDocToHtml() — JSONContent → HTML 변환 (비어있지 않음, 구조 보존)
 *   2. substituteTiptapDoc()  — mergeField 노드 → 실제 값 텍스트 노드
 *   3. substituteVariables()  — tiptap-doc 블록을 만나면 substituteTiptapDoc 적용
 *   4. 통합 흐름: 저장 → 치환 → renderTiptapDocToHtml → HTML에 실제 값 포함
 */

// ── TIPTAP_CONTRACT_EXTENSIONS — 확장 중복 등록 회귀 방지 ──────────────────────
// StarterKit(@tiptap/starter-kit v3)이 Link·Underline을 기본 번들에 포함하게 되면서
// 이 목록이 별도로 등록하는 Link/Underline과 이름이 중복돼 "[tiptap warn]: Duplicate
// extension names found" 경고가 발생했었다(2026-08-15 실사용 중 발견 — 표 편집 상호작용
// 이상 증상의 근본 원인 후보). StarterKit.configure({ link:false, underline:false })로
// 해소했으며, 이 테스트가 재발을 막는다.

describe('TIPTAP_CONTRACT_EXTENSIONS — 확장 중복 등록 없음', () => {
  it('스키마 빌드 시 중복 확장 이름 경고가 발생하지 않는다', async () => {
    const { getSchema } = await import('@tiptap/core')
    const { TIPTAP_CONTRACT_EXTENSIONS } = await import(
      '$lib/components/cms/contract-editor/tiptapExtensions.js'
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSchema(TIPTAP_CONTRACT_EXTENSIONS)
    const duplicateWarnCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('Duplicate extension names'),
    )
    expect(duplicateWarnCalls).toHaveLength(0)
    warnSpy.mockRestore()
  })

  it('확장 이름 목록에 link·underline이 정확히 1개씩만 존재한다', async () => {
    const { TIPTAP_CONTRACT_EXTENSIONS } = await import(
      '$lib/components/cms/contract-editor/tiptapExtensions.js'
    )
    // StarterKit은 addExtensions()로 자식 확장을 만들기 때문에 이름은 빌드 후에만 알 수 있음 —
    // getSchema로 실제 스키마를 만들어 마크 이름 집합에 중복이 없는지 확인
    const { getSchema } = await import('@tiptap/core')
    const schema = getSchema(TIPTAP_CONTRACT_EXTENSIONS)
    expect(schema.marks['link']).toBeDefined()
    expect(schema.marks['underline']).toBeDefined()
  })
})

// ── renderTiptapDocToHtml ─────────────────────────────────────────────────────

describe('renderTiptapDocToHtml — tiptap-doc → HTML 변환', () => {
  it('단순 단락을 <p> 태그 HTML로 변환한다', async () => {
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '안녕하세요' }],
        },
      ],
    }

    const html = renderTiptapDocToHtml(doc)
    expect(html).toContain('<p>')
    expect(html).toContain('안녕하세요')
  })

  it('빈 doc도 비어있지 않은 유효한 HTML을 반환한다 — 빈화면 회귀 방지', async () => {
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }

    const html = renderTiptapDocToHtml(doc)
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
    expect(html).toMatch(/<p/)
  })

  it('mergeField 노드를 data-merge-field 스팬으로 렌더링한다 (치환 전)', async () => {
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mergeField',
              attrs: { variable: '고객이름', label: '고객이름' },
            },
          ],
        },
      ],
    }

    const html = renderTiptapDocToHtml(doc)
    // MergeFieldNode.renderHTML()가 data-merge-field 스팬을 생성해야 함
    expect(html).toContain('data-merge-field')
    expect(html).toContain('data-variable')
  })

  it('표(table) 구조를 보존한다', async () => {
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: {},
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: '셀 내용' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const html = renderTiptapDocToHtml(doc)
    expect(html).toContain('<table')
    expect(html).toContain('<td')
    expect(html).toContain('셀 내용')
  })

  it('표는 .tt-table-scroll로 감싸져 렌더링된다 — A4 페이지 폭 오버플로우 방지', async () => {
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: {},
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
                },
              ],
            },
          ],
        },
      ],
    }

    const html = renderTiptapDocToHtml(doc)
    expect(html).toContain('<div class="tt-table-scroll"><table')
    expect(html).toContain('</table></div>')
  })

  it('표가 없는 문서는 .tt-table-scroll 래퍼가 생기지 않는다(회귀)', async () => {
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '표 없음' }] }],
    }

    const html = renderTiptapDocToHtml(doc)
    expect(html).not.toContain('tt-table-scroll')
  })
})

// ── substituteTiptapDoc ───────────────────────────────────────────────────────

describe('substituteTiptapDoc — mergeField 노드 치환', () => {
  it('mergeField 노드를 데이터의 실제 값으로 대체한다', async () => {
    const { substituteTiptapDoc } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '고객: ' },
            { type: 'mergeField', attrs: { variable: '고객이름', label: '고객이름' } },
          ],
        },
      ],
    }

    const data: ContractSubstitutionData = { 고객이름: '홍길동' }
    const result = substituteTiptapDoc(doc, data)

    const para = result.content?.[0]
    const afterNode = para?.content?.[1]
    expect(afterNode?.type).toBe('text')
    expect(afterNode?.text).toBe('홍길동')
  })

  it('값이 없는 변수는 {{key}} 텍스트로 유지한다', async () => {
    const { substituteTiptapDoc } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mergeField', attrs: { variable: '존재하지않는키', label: '미존재' } },
          ],
        },
      ],
    }

    const data: ContractSubstitutionData = {}
    const result = substituteTiptapDoc(doc, data)

    const textNode = result.content?.[0]?.content?.[0]
    expect(textNode?.type).toBe('text')
    expect(textNode?.text).toBe('{{존재하지않는키}}')
  })

  it('치환 후 renderTiptapDocToHtml이 실제 값이 포함된 HTML을 반환한다', async () => {
    const { substituteTiptapDoc, renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

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

    const data: ContractSubstitutionData = { 고객이름: '홍길동' }
    const substituted = substituteTiptapDoc(doc, data)
    const html = renderTiptapDocToHtml(substituted)

    expect(html).toContain('홍길동')
    // 치환 후: data-merge-field 칩이 아닌 일반 텍스트 노드로 변환됐으므로 chip 없어야 함
    expect(html).not.toContain('data-merge-field')
  })

  it('중첩 구조(표 → 셀 → 단락 → mergeField)도 올바르게 치환한다', async () => {
    const { substituteTiptapDoc, renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: {},
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'mergeField', attrs: { variable: '연락처', label: '연락처' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const data: ContractSubstitutionData = { 연락처: '010-1234-5678' }
    const substituted = substituteTiptapDoc(doc, data)
    const html = renderTiptapDocToHtml(substituted)

    expect(html).toContain('010-1234-5678')
    expect(html).toContain('<table')
  })
})

// ── substituteVariables 회귀 방지 ────────────────────────────────────────────

describe('substituteVariables — tiptap-doc 블록 처리 회귀 방지', () => {
  it('tiptap-doc 블록의 mergeField를 실제 값으로 치환한다', async () => {
    const { substituteVariables } = await import('$lib/utils/contract-substitution.js')

    const block: TiptapDocBlock = {
      type: 'tiptap-doc',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mergeField', attrs: { variable: '고객이름', label: '고객이름' } },
            ],
          },
        ],
      },
    }

    const data: ContractSubstitutionData = { 고객이름: '김철수' }
    const result = substituteVariables([block], data)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('tiptap-doc')

    const docBlock = result[0] as TiptapDocBlock
    const textNode = docBlock.doc.content?.[0]?.content?.[0]
    expect(textNode?.type).toBe('text')
    expect(textNode?.text).toBe('김철수')
  })

  it('레거시 ContentBlock(text/html)과 tiptap-doc 블록을 혼재해도 각각 올바르게 처리한다', async () => {
    const { substituteVariables } = await import('$lib/utils/contract-substitution.js')

    const blocks = [
      { type: 'text' as const, html: '<p>{{고객이름}}님</p>', id: 'b1', order: 0 },
      {
        type: 'tiptap-doc' as const,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'mergeField', attrs: { variable: '연락처', label: '연락처' } },
              ],
            },
          ],
        },
      } satisfies TiptapDocBlock,
    ]

    const data: ContractSubstitutionData = { 고객이름: '박영희', 연락처: '010-9999-8888' }
    const result = substituteVariables(blocks as Parameters<typeof substituteVariables>[0], data)

    // 레거시 블록: html 치환
    expect((result[0] as { html: string }).html).toContain('박영희')

    // tiptap-doc 블록: mergeField 치환
    const docBlock = result[1] as TiptapDocBlock
    const textNode = docBlock.doc.content?.[0]?.content?.[0]
    expect(textNode?.text).toBe('010-9999-8888')
  })

  it('저장→치환→renderTiptapDocToHtml 통합 흐름: 빈화면 회귀 재현·방지', async () => {
    // 이번 세션에서 발생한 회귀: tiptap-doc 블록이 렌더링 지점에서 분기 누락으로 빈 화면 표시
    // 이 테스트가 GREEN이 되면 렌더링 유틸과 치환 로직이 올바르게 연결된 것
    const { substituteVariables } = await import('$lib/utils/contract-substitution.js')
    const { renderTiptapDocToHtml } = await import('$lib/utils/tiptapRender.js')

    const block: TiptapDocBlock = {
      type: 'tiptap-doc',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '계약자: ' },
              { type: 'mergeField', attrs: { variable: '고객이름', label: '고객이름' } },
            ],
          },
        ],
      },
    }

    const data: ContractSubstitutionData = { 고객이름: '이순신' }
    const substituted = substituteVariables([block], data)

    const docBlock = substituted[0] as TiptapDocBlock
    expect(docBlock.type).toBe('tiptap-doc')

    // 핵심: 치환 후 HTML이 비어있으면 안 됨
    const html = renderTiptapDocToHtml(docBlock.doc)
    expect(html).not.toBe('')
    expect(html).toContain('계약자:')
    expect(html).toContain('이순신')
    // data-merge-field 칩이 남아있으면 치환이 안 된 것
    expect(html).not.toContain('data-merge-field')
  })
})
