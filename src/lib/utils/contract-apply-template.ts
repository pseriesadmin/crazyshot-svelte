/**
 * contract-apply-template.ts
 *
 * ContractTemplatePreviewModal.send() 과 RentalContractViewer.openEditorForTemplate() 에
 * 중복 구현된 "init-contract + PATCH" 로직을 공용 유틸로 통합.
 *
 * 특약(specifications)은 변수 치환 대상이 아닌 관리자 자유 입력 텍스트이므로
 * contentBlocks 와는 독립적으로 전달받아 그대로 저장한다.
 */

export interface ApplyTemplateOptions {
  /** 기존 contractId (null이면 신규 생성) */
  contractId: string | null
  /** 예약 ID */
  reservationId: number
  /** 계약서 제목 */
  title: string
  /** 저장할 content_blocks (호출부에서 이미 변수 치환을 완료한 값 또는 원본) */
  contentBlocks: unknown[]
  /** 특약 조항 — 변수 치환 없이 원문 그대로 저장 */
  specifications?: { key: string; value: string }[]
  /** 템플릿 ID (이력 추적용, 선택) */
  templateId?: string | null
  /**
   * 작성 모드 — 'flow' | 'canvas' | 'spreadsheet'.
   * canvas / spreadsheet 템플릿 적용 시 반드시 해당 모드를 전달해야 contracts 테이블에 정확히 기록됨.
   * 미전달 시 서버 기본값(flow)이 유지되므로 canvas/spreadsheet 발행 경로는 반드시 명시할 것.
   */
  authoring_mode?: 'flow' | 'canvas' | 'spreadsheet'
  /**
   * 캔버스 문서 (canvas 모드 전용).
   * authoring_mode='canvas'일 때 함께 전달하지 않으면 고객 서명 화면에서 배경이 렌더링되지 않음.
   */
  canvasDocument?: unknown
  /**
   * 스프레드시트 문서 (spreadsheet 모드 전용).
   * authoring_mode='spreadsheet'일 때 함께 전달해야 contracts 테이블에 spreadsheet_document가 저장됨.
   */
  spreadsheetDocument?: unknown
}

export type ApplyTemplateResult =
  | { contractId: string; error?: undefined }
  | { error: string; contractId?: undefined }

/**
 * 1. contractId 가 없으면 신규 계약서를 init-contract 로 생성.
 * 2. PATCH /api/cms/contracts/:id/content 로 본문·특약·템플릿ID 저장.
 * 3. 성공 시 { contractId } 반환 / 실패 시 { error } 반환.
 */
export async function applyContractTemplate(
  opts: ApplyTemplateOptions
): Promise<ApplyTemplateResult> {
  let activeContractId = opts.contractId

  if (!activeContractId) {
    const initRes = await fetch(
      `/api/cms/reservations/${opts.reservationId}/init-contract`,
      { method: 'POST' }
    )
    if (!initRes.ok) {
      const body = await initRes.json().catch(() => ({})) as { error?: string }
      return { error: body.error ?? '계약서 생성 실패' }
    }
    const { contractId: newId } = await initRes.json() as { contractId: string }
    activeContractId = newId
  }

  const patchRes = await fetch(
    `/api/cms/contracts/${activeContractId}/content`,
    {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:          opts.title,
        content_blocks: opts.contentBlocks,
        specifications: opts.specifications ?? [],
        ...(opts.templateId != null         ? { template_id:          opts.templateId }         : {}),
        ...(opts.authoring_mode != null     ? { authoring_mode:        opts.authoring_mode }     : {}),
        ...(opts.canvasDocument != null     ? { canvas_document:       opts.canvasDocument }     : {}),
        ...(opts.spreadsheetDocument != null ? { spreadsheet_document: opts.spreadsheetDocument } : {}),
      }),
    }
  )

  if (!patchRes.ok) {
    const body = await patchRes.json().catch(() => ({})) as { error?: string }
    return { error: body.error ?? '저장 실패' }
  }

  return { contractId: activeContractId }
}
