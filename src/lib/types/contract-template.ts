export interface ContractTemplate {
  id:                         string
  title:                      string
  content_blocks:             unknown[]
  specifications:             unknown[]
  status:                     'active' | 'archived'
  requires_issuer_signature:  boolean
  created_at:                 string
  updated_at:                 string
  /**
   * 작성 모드: 'flow'(문서형 TipTap) | 'canvas'(고정캔버스형) | 'spreadsheet'(스프레드시트형).
   * null 또는 undefined는 레거시 템플릿으로 'flow' 취급.
   */
  authoring_mode?:            'flow' | 'canvas' | 'spreadsheet' | null
  /**
   * canvas 모드 전용: 배경 페이지 + 필드 배치 정보 (CanvasDocument 직렬화).
   * flow 모드 또는 미지정 시 null.
   */
  canvas_document?:           unknown
  /**
   * spreadsheet 모드 전용: 시트별 rows/merges/colWidths/cellFormatting (SpreadsheetDocument 직렬화).
   * flow/canvas 모드 또는 미지정 시 null.
   */
  spreadsheet_document?:      unknown
}

export type ContractTemplateSummary = Pick<ContractTemplate, 'id' | 'title' | 'status' | 'created_at'>
