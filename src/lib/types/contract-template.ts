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
   * 작성 모드: 'flow'(문서형 TipTap) | 'canvas'(고정캔버스형) | 'spreadsheet'(스프레드시트형)
   * | 'html'(고정 HTML 서식, 2026-09-04 신설).
   * null 또는 undefined는 레거시 템플릿으로 'flow' 취급.
   */
  authoring_mode?:            'flow' | 'canvas' | 'spreadsheet' | 'html' | null
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
  /**
   * html 모드 전용: 치환 완료된 최종 HTML 문자열(TEXT). flow/canvas/spreadsheet 모드 또는
   * 미지정 시 null.
   */
  html_document?:             string | null
  /**
   * html 모드 전용: 발행자(대표이사) 서명·직인 이미지 URL(Migration #450).
   * cms_signature_assets.image_url 값을 그대로 복사 저장 — FK 아님. flow/canvas/spreadsheet
   * 모드 또는 미지정 시 null.
   */
  html_issuer_signature_url?: string | null
  /**
   * html 모드 전용: 발행자 서명·직인 이미지 너비(px, Migration #451). NULL이면 기본값(90px).
   */
  html_issuer_signature_width?: number | null
  /**
   * html 모드 전용: 발행자 서명·직인 이미지의 기본 중앙 위치 대비 가로/세로 이동 오프셋
   * (px, Migration #463). NULL이면 0(중앙) — 드래그로 옮기지 않은 기존 템플릿과 하위호환.
   */
  html_issuer_signature_offset_x?: number | null
  html_issuer_signature_offset_y?: number | null
  /**
   * html 모드 전용: "계약 및 인수 확인"·"개인정보동의" 섹션 문단 텍스트(Migration #464).
   * 빈 줄로 문단 구분, 문단 맨 앞 "[라벨]"은 자동 굵게. NULL이면 기본 문구 사용.
   */
  contract_terms_text?: string | null
  privacy_terms_text?: string | null
}

export type ContractTemplateSummary = Pick<ContractTemplate, 'id' | 'title' | 'status' | 'created_at' | 'authoring_mode'>
