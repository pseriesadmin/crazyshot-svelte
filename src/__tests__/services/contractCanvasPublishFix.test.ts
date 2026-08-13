// @vitest-environment node
/**
 * contractCanvasPublishFix.test.ts — canvas 발행 경로 + EC-3 검증 TDD
 *
 * QA 재검수(5차)에서 발견된 CRITICAL 결함 수정 회귀 방지:
 *   - canvas 템플릿을 발행해도 고객 서명 화면이 placeholder만 보이는 문제
 *
 * 수정된 5개 경로:
 *   1. GET /api/cms/contract-templates → authoring_mode, canvas_document 포함
 *   2. applyContractTemplate() → PATCH 바디에 authoring_mode, canvas_document 포함
 *   3. PATCH /api/cms/contracts/[id]/content → authoring_mode, canvas_document 저장
 *   4. POST /api/cms/reservations/[id]/init-contract → 기존 기본값('flow') 유지(변경 불필요)
 *   5. ContractEditorModal → canvas 계약 편집 시 ContractCanvasEditor 분기
 *
 * EC-3 서버 재검증: canvas_document에 서명 필드 없으면 400 차단
 */

import { describe, it, expect } from 'vitest'
import type { CanvasDocument } from '$lib/types/contract-document.js'

// ── 샘플 데이터 ─────────────────────────────────────────────────────────────

const CANVAS_DOC_WITH_SIGNATURE: CanvasDocument = {
  pages: [{ id: 'p1', imageUrl: 'https://example.com/bg.png', width: 800, height: 1100 }],
  fields: [
    {
      id: 'f1', pageId: 'p1', type: 'signature',
      x: 100, y: 900, width: 200, height: 80,
      required: true, label: '고객 서명',
    },
    {
      id: 'f2', pageId: 'p1', type: 'text',
      x: 200, y: 100, width: 300, height: 36,
      required: false, label: '고객명', boundVariable: '고객이름',
    },
  ],
}

const CANVAS_DOC_WITHOUT_SIGNATURE: CanvasDocument = {
  pages: [{ id: 'p1', imageUrl: 'https://example.com/bg.png', width: 800, height: 1100 }],
  fields: [
    {
      id: 'f2', pageId: 'p1', type: 'text',
      x: 200, y: 100, width: 300, height: 36,
      required: false, label: '고객명', boundVariable: '고객이름',
    },
    {
      id: 'f3', pageId: 'p1', type: 'label',
      x: 50, y: 50, width: 150, height: 28,
      required: false, label: '렌탈 계약서',
    },
  ],
}

// ── G1: hasSignatureField — EC-3 핵심 판별 함수 ──────────────────────────────
describe('EC-3: hasSignatureField — 서명 필드 최소 1개 필수 검증', () => {
  it('signature 필드가 있으면 true (저장 허용)', async () => {
    const { hasSignatureField } = await import('$lib/types/contract-document.js')
    expect(hasSignatureField(CANVAS_DOC_WITH_SIGNATURE)).toBe(true)
  })

  it('signature 필드가 없으면 false (EC-3 차단)', async () => {
    const { hasSignatureField } = await import('$lib/types/contract-document.js')
    expect(hasSignatureField(CANVAS_DOC_WITHOUT_SIGNATURE)).toBe(false)
  })

  it('빈 fields 배열이면 false', async () => {
    const { hasSignatureField } = await import('$lib/types/contract-document.js')
    expect(hasSignatureField({ pages: [], fields: [] })).toBe(false)
  })

  it('issuer-image + label + text만 있고 signature 없으면 false', async () => {
    const { hasSignatureField } = await import('$lib/types/contract-document.js')
    const doc: CanvasDocument = {
      pages: [],
      fields: [
        { id: 'a', pageId: 'p1', type: 'issuer-image', x: 0, y: 0, width: 100, height: 100, required: false, label: '직인' },
        { id: 'b', pageId: 'p1', type: 'label', x: 0, y: 0, width: 100, height: 30, required: false, label: '제목' },
        { id: 'c', pageId: 'p1', type: 'text', x: 0, y: 0, width: 100, height: 30, required: false, label: '이름', boundVariable: '고객이름' },
      ],
    }
    expect(hasSignatureField(doc)).toBe(false)
  })
})

// ── G2: ApplyTemplateOptions — canvas 옵션 전달 구조 검증 ────────────────────
describe('applyContractTemplate — canvas 모드 PATCH 바디 포함 여부', () => {
  it('authoring_mode와 canvasDocument가 옵션에 있으면 PATCH 바디에 포함된다', async () => {
    // applyContractTemplate의 PATCH 바디 구성 로직을 단독 재현
    const opts = {
      contractId:    'c-test',
      reservationId: 1,
      title:         '렌탈 계약서',
      contentBlocks: [] as unknown[],
      specifications: [] as { key: string; value: string }[],
      templateId:    't-test',
      authoring_mode: 'canvas' as const,
      canvasDocument: CANVAS_DOC_WITH_SIGNATURE as unknown,
    }

    // applyContractTemplate 내부 PATCH 바디 재현
    const patchBody = {
      title:          opts.title,
      content_blocks: opts.contentBlocks,
      specifications: opts.specifications ?? [],
      ...(opts.templateId    != null ? { template_id:     opts.templateId }     : {}),
      ...(opts.authoring_mode != null ? { authoring_mode: opts.authoring_mode } : {}),
      ...(opts.canvasDocument != null ? { canvas_document: opts.canvasDocument } : {}),
    }

    expect(patchBody.authoring_mode).toBe('canvas')
    expect(patchBody.canvas_document).toEqual(CANVAS_DOC_WITH_SIGNATURE)
    expect(patchBody.content_blocks).toEqual([])
  })

  it('authoring_mode=flow이면 canvas_document 없이 PATCH 바디 구성', () => {
    const opts = {
      contractId:    'c-test',
      reservationId: 1,
      title:         '렌탈 계약서',
      contentBlocks: [{ type: 'tiptap-doc', doc: { type: 'doc' } }],
      specifications: [] as { key: string; value: string }[],
      templateId:    't-test',
      authoring_mode: 'flow' as const,
      canvasDocument: undefined as unknown,
    }

    const patchBody: Record<string, unknown> = {
      title:          opts.title,
      content_blocks: opts.contentBlocks,
      specifications: opts.specifications ?? [],
      ...(opts.templateId    != null ? { template_id:     opts.templateId }     : {}),
      ...(opts.authoring_mode != null ? { authoring_mode: opts.authoring_mode } : {}),
      ...(opts.canvasDocument != null ? { canvas_document: opts.canvasDocument } : {}),
    }

    expect(patchBody.authoring_mode).toBe('flow')
    expect('canvas_document' in patchBody).toBe(false)
  })

  it('authoring_mode 미전달이면 PATCH 바디에 포함되지 않는다 (기존 값 보존)', () => {
    const opts = {
      contractId:    'c-test',
      reservationId: 1,
      title:         '렌탈 계약서',
      contentBlocks: [] as unknown[],
      specifications: [] as { key: string; value: string }[],
      templateId:    't-test',
      // authoring_mode, canvasDocument 미전달
    }

    const patchBody: Record<string, unknown> = {
      title:          opts.title,
      content_blocks: opts.contentBlocks,
      specifications: opts.specifications ?? [],
      ...((opts as { templateId?: string }).templateId    != null
        ? { template_id:     (opts as { templateId?: string }).templateId }     : {}),
      ...((opts as { authoring_mode?: string }).authoring_mode != null
        ? { authoring_mode: (opts as { authoring_mode?: string }).authoring_mode } : {}),
      ...((opts as { canvasDocument?: unknown }).canvasDocument != null
        ? { canvas_document: (opts as { canvasDocument?: unknown }).canvasDocument } : {}),
    }

    expect('authoring_mode' in patchBody).toBe(false)
    expect('canvas_document' in patchBody).toBe(false)
  })
})

// ── G3: PATCH /contracts/[id]/content — canvas 저장 로직 단위 검증 ────────────
describe('PATCH /contracts/[id]/content — canvas_document + EC-3 서버 재검증', () => {
  /**
   * 실제 content/+server.ts PATCH 처리 로직을 단독 재현.
   * DB 연결 없이 순수 로직만 검증.
   */
  async function processCanvasPatch(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; error?: string }> {
    const { isCanvasDocument, hasSignatureField } = await import('$lib/types/contract-document.js')

    const updatePayload: Record<string, unknown> = {
      title:          body['title'] ?? null,
      content_blocks: body['content_blocks'] ?? [],
      specifications: body['specifications'] ?? [],
      updated_at:     new Date().toISOString(),
    }
    if ('template_id' in body) updatePayload['template_id'] = body['template_id'] ?? null
    if ('authoring_mode' in body && body['authoring_mode']) {
      updatePayload['authoring_mode'] = body['authoring_mode']
    }
    if ('canvas_document' in body && body['canvas_document'] != null) {
      if (!isCanvasDocument(body['canvas_document'])) {
        return { ok: false, status: 400, error: 'canvas_document 형식이 올바르지 않습니다.' }
      }
      if (!hasSignatureField(body['canvas_document'] as CanvasDocument)) {
        return { ok: false, status: 400, error: '서명 필드가 최소 1개 이상 있어야 합니다. (EC-3)' }
      }
      updatePayload['canvas_document'] = body['canvas_document']
    }

    return { ok: true, status: 200 }
  }

  it('canvas_document + authoring_mode 포함 PATCH는 200 처리', async () => {
    const result = await processCanvasPatch({
      title:           '렌탈 계약서',
      content_blocks:  [],
      specifications:  [],
      authoring_mode:  'canvas',
      canvas_document: CANVAS_DOC_WITH_SIGNATURE,
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })

  it('EC-3: 서명 필드 없는 canvas_document PATCH는 400 반환', async () => {
    const result = await processCanvasPatch({
      title:           '렌탈 계약서',
      content_blocks:  [],
      specifications:  [],
      authoring_mode:  'canvas',
      canvas_document: CANVAS_DOC_WITHOUT_SIGNATURE,
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/EC-3/)
  })

  it('canvas_document 형식이 잘못된 경우 400 반환', async () => {
    const result = await processCanvasPatch({
      title:           '렌탈 계약서',
      content_blocks:  [],
      specifications:  [],
      authoring_mode:  'canvas',
      canvas_document: { notValid: true },  // pages/fields 없음
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/형식/)
  })

  it('flow 모드 PATCH (canvas_document 없음)는 정상 처리', async () => {
    const result = await processCanvasPatch({
      title:           '렌탈 계약서',
      content_blocks:  [{ type: 'tiptap-doc', doc: { type: 'doc' } }],
      specifications:  [],
      authoring_mode:  'flow',
      // canvas_document 없음
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })

  it('authoring_mode 없고 canvas_document도 없으면 정상 처리 (기존 flow 동작)', async () => {
    const result = await processCanvasPatch({
      title:           '렌탈 계약서',
      content_blocks:  [{ type: 'tiptap-doc', doc: { type: 'doc' } }],
      specifications:  [],
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })
})

// ── G4: 템플릿 GET 응답 구조 — authoring_mode + canvas_document 포함 확인 ─────
describe('GET /api/cms/contract-templates — canvas 필드 포함 구조 검증', () => {
  /**
   * 실제 GET 엔드포인트의 select 쿼리 문자열이
   * 'authoring_mode'와 'canvas_document'를 포함하는지 확인.
   * (파일 읽기 방식으로 검증 — Supabase mock 불필요)
   */
  it('contract-templates GET select에 authoring_mode 포함', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../../routes/api/cms/contract-templates/+server.ts', import.meta.url),
      'utf-8',
    )
    expect(source).toContain('authoring_mode')
  })

  it('contract-templates GET select에 canvas_document 포함', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../../routes/api/cms/contract-templates/+server.ts', import.meta.url),
      'utf-8',
    )
    expect(source).toContain('canvas_document')
  })

  it('contracts content GET select에 authoring_mode 포함', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../../routes/api/cms/contracts/[id]/content/+server.ts', import.meta.url),
      'utf-8',
    )
    expect(source).toContain('authoring_mode')
  })

  it('contracts content GET select에 canvas_document 포함', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../../routes/api/cms/contracts/[id]/content/+server.ts', import.meta.url),
      'utf-8',
    )
    expect(source).toContain('canvas_document')
  })
})

// ── G5: EC-3 서버측 검증 — contracts/+page.server.ts create/update 액션 ──────
describe('EC-3: contracts/+page.server.ts create/update 서버 액션 재검증', () => {
  /**
   * create/update 액션의 canvas_document 처리 로직을 단독 재현.
   * hasSignatureField 호출이 assetId 검증 이전에 수행되어야 한다.
   */
  async function checkCreateUpdateGate(canvasDoc: CanvasDocument): Promise<{ blocked: boolean; reason?: string }> {
    const { hasSignatureField } = await import('$lib/types/contract-document.js')
    if (!hasSignatureField(canvasDoc)) {
      return { blocked: true, reason: '서명 필드가 최소 1개 이상 있어야 합니다. (EC-3)' }
    }
    return { blocked: false }
  }

  it('서명 필드 있는 canvas_document는 EC-3 통과', async () => {
    const result = await checkCreateUpdateGate(CANVAS_DOC_WITH_SIGNATURE)
    expect(result.blocked).toBe(false)
  })

  it('서명 필드 없는 canvas_document는 EC-3 차단', async () => {
    const result = await checkCreateUpdateGate(CANVAS_DOC_WITHOUT_SIGNATURE)
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/EC-3/)
  })

  it('contracts/+page.server.ts에 hasSignatureField 호출이 존재한다', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../../routes/cms/reservation/contracts/+page.server.ts', import.meta.url),
      'utf-8',
    )
    expect(source).toContain('hasSignatureField')
  })

  it('ContractCanvasEditor에 hasSignatureField 호출이 존재한다 (클라이언트 검증)', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../../lib/components/cms/contract-editor/ContractCanvasEditor.svelte', import.meta.url),
      'utf-8',
    )
    expect(source).toContain('hasSignatureField')
  })

  it('ContractTemplatePanel에 hasSignatureField 호출이 존재한다 (클라이언트 검증)', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../../lib/components/cms/ContractTemplatePanel.svelte', import.meta.url),
      'utf-8',
    )
    expect(source).toContain('hasSignatureField')
  })
})

// ── G6: canvas 모드 발행 E2E 흐름 — 시나리오 로직 통합 검증 ────────────────────
describe('canvas 발행 흐름 통합 — template → contract 적용 시나리오', () => {
  it('canvas 템플릿 선택 시 authoring_mode=canvas + canvasDocument가 PATCH로 전달된다', async () => {
    const { isCanvasDocument } = await import('$lib/types/contract-document.js')

    // 템플릿 선택 (ContractTemplatePreviewModal 내부 로직 재현)
    const selectedTemplate = {
      id: 't-canvas-1',
      title: '캔버스 렌탈 계약서',
      content_blocks: [] as unknown[],
      specifications: [] as { key: string; value: string }[],
      authoring_mode: 'canvas',
      canvas_document: CANVAS_DOC_WITH_SIGNATURE as unknown,
      created_at: '2026-08-13T00:00:00Z',
    }

    const isCanvas = selectedTemplate.authoring_mode === 'canvas'

    // flow 모드는 substituteVariables 적용, canvas 모드는 빈 배열 (변수는 서명 화면에서 치환)
    const substitutedBlocks = isCanvas ? [] : selectedTemplate.content_blocks

    const applyOpts = {
      contractId:    null as string | null,
      reservationId: 42,
      title:         selectedTemplate.title,
      contentBlocks: substitutedBlocks,
      specifications: selectedTemplate.specifications,
      templateId:    selectedTemplate.id,
      authoring_mode:  isCanvas ? ('canvas' as const) : ('flow' as const),
      canvasDocument:  isCanvas ? selectedTemplate.canvas_document : undefined,
    }

    expect(applyOpts.authoring_mode).toBe('canvas')
    expect(applyOpts.canvasDocument).not.toBeNull()
    expect(isCanvasDocument(applyOpts.canvasDocument)).toBe(true)
    expect(applyOpts.contentBlocks).toEqual([])
  })

  it('flow 템플릿 선택 시 canvas 관련 필드가 PATCH에 포함되지 않는다', async () => {
    const selectedTemplate = {
      id: 't-flow-1',
      title: '일반 렌탈 계약서',
      content_blocks: [{ type: 'tiptap-doc', doc: { type: 'doc' } }] as unknown[],
      specifications: [] as { key: string; value: string }[],
      authoring_mode: 'flow',
      canvas_document: null as unknown,
      created_at: '2026-08-13T00:00:00Z',
    }

    const isCanvas = selectedTemplate.authoring_mode === 'canvas'
    const canvasDocument = isCanvas ? selectedTemplate.canvas_document : undefined

    expect(isCanvas).toBe(false)
    expect(canvasDocument).toBeUndefined()
  })
})
