/**
 * sheet-format.ts — .xlsx 시트 파싱 관련 공유 타입
 *
 * xlsxImport.ts(클라이언트 전용 DOMParser 사용)에서 분리한 순수 타입 정의.
 * SSR 렌더 경로(/contract/[token], spreadsheetRender.ts)가 xlsxImport.ts의
 * DOMParser 의존 코드를 서버 번들에 끌어들이지 않도록 타입만 이 파일에서 import.
 * xlsxImport.ts / contract-document.ts / spreadsheetRender.ts 모두 여기서 import.
 */

/** 병합 범위 — 선택 범위(range) 좌상단을 (0,0)으로 하는 상대 좌표 */
export interface SheetMergeRange {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

/** 단일 셀의 서식 정보 */
export interface XlsxCellFormatting {
  /** CSS 배경색 — '#RRGGBB'(.xlsx 임포트) 또는 'rgb(r, g, b)'(jspreadsheet-ce 툴바 저장값) */
  backgroundColor?: string
  /** CSS 테두리 색 '#RRGGBB' */
  borderColor?: string
  /** CSS 폰트색 — '#RRGGBB' 또는 'rgb(r, g, b)' (2026-08-20 추가 —
   *  기존엔 이 필드가 아예 없어 jspreadsheet 툴바로 지정한 폰트색이 저장 시 통째로 유실됐다) */
  color?: string
  /** CSS font-weight — 'bold' 등 (jspreadsheet 굵게 토글이 남기는 값 그대로) */
  fontWeight?: string
  /** CSS font-size — jspreadsheet 툴바는 키워드값(x-small~x-large) 사용, .xlsx 임포트는 'Npt' */
  fontSize?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 이미지 오버레이 셀(서명/직인) 값 규약 — 스프레드시트 모드 전용 (2026-08-16)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 셀 값 문자열 끝에 이 접두사 + "너비:URL"이 붙어 있으면, 그 앞부분은 원래 텍스트(예:
 * 계약서 서식에 이미 인쇄돼 있던 "(인)")를 그대로 유지하고 이미지(서명/직인)를 그 위에
 * 겹쳐(오버레이) 그린다.
 *
 * ⚠️ 2026-08-16 최초 구현은 값 전체를 이미지로 "교체"했으나, Stephen 실사용 피드백
 * ("이미지 확인되지만 레이어로 텍스트 또는 셀 위에 올라가지 않음")에 따라 "텍스트는 그대로
 * 두고 이미지가 그 위에 겹쳐 보여야 한다"는 요구로 마커 위치를 "셀 전체"에서 "기존 텍스트
 * 뒤에 이어붙이는 접미사"로 변경 — 실제 도장을 인쇄된 서명란 위에 찍는 것과 동일한 개념.
 * 이어서 "문서형(흐름형) 에디터의 이미지 크기설정 바(소100/중200/대400 프리셋 + 너비
 * 직접입력)와 동일한 UI를 적용해달라"는 요청으로 너비도 마커에 함께 인코딩한다
 * (`ContractDocumentEditor.svelte`의 `ImageWithNodeView` 프리셋 값과 동일하게 유지 —
 * 두 에디터의 크기 감각이 어긋나지 않도록).
 *
 * jspreadsheet-ce는 컬럼 type='image'일 때만 값이 "data:image"로 시작하는 base64를
 * <img>로 그려주는데, 우리 서명/직인 자산(cms_signature_assets)은 Storage의 실제 URL
 * (image_url)로 저장돼 있어 base64 변환 없이 그대로 참조하고 싶다 — 라이브러리 내장 image
 * 타입 대신 커스텀 render 콜백(ContractSpreadsheetEditor.svelte)/렌더러
 * (spreadsheetRender.ts) 양쪽에서 이 마커를 직접 감지해서 텍스트 위에 <img>를 절대위치로
 * 겹쳐 그린다. SpreadsheetSheet.rows(string[][])는 이 접두사가 붙은 일반 문자열을 그대로
 * 저장 — SpreadsheetDocument 스키마 자체는 변경 불필요.
 */
export const IMAGE_CELL_PREFIX = 'cs-image://'

/** 너비가 마커에 없을 때(레거시 데이터 등) 적용하는 기본값 — ContractDocumentEditor.svelte
 *  삽입 기본값(200px)과 동일하게 유지 */
export const DEFAULT_IMAGE_OVERLAY_WIDTH = 200

/**
 * 셀 값을 "원래 텍스트" / "오버레이 이미지 URL" / "너비(px)" / "중심 기준 이동 오프셋
 * (offsetX, offsetY px)"으로 분리한다. 마커가 없으면 imageUrl은 null이고 text는 원본
 * 값 그대로.
 *
 * 마커 형식(최신, 2026-08-16 드래그 이동 지원 추가):
 *   `{IMAGE_CELL_PREFIX}{width}:{offsetX}:{offsetY}:{url}`
 * offsetX/offsetY는 셀 중앙을 (0,0)으로 하는 드래그 이동량(px, 음수 가능) — 문서형
 * ImageWithNodeView의 "겹치기" 드래그(x/y 절대좌표)와 달리 여기서는 항상 중앙 기준
 * 상대 오프셋으로 저장(셀 크기가 나중에 바뀌어도 위치 감각이 유지되도록).
 *
 * 하위호환: 12~15라운드에서 쓰던 구형 2필드 마커(`{width}:{url}`, 오프셋 없음)와
 * 최초 10~11라운드의 URL-only 마커도 계속 정상 파싱(오프셋은 0,0 기본값).
 */
export function splitCellImageOverlay(
  value: string,
): { text: string; imageUrl: string | null; width: number; offsetX: number; offsetY: number } {
  const idx = value.indexOf(IMAGE_CELL_PREFIX)
  if (idx === -1) {
    return { text: value, imageUrl: null, width: DEFAULT_IMAGE_OVERLAY_WIDTH, offsetX: 0, offsetY: 0 }
  }

  const text = value.slice(0, idx)
  const remainder = value.slice(idx + IMAGE_CELL_PREFIX.length)

  // 최신 4필드: width:offsetX:offsetY:url
  const m4 = remainder.match(/^(\d+):(-?\d+):(-?\d+):(.+)$/)
  if (m4) {
    return {
      text,
      imageUrl: m4[4],
      width: parseInt(m4[1], 10),
      offsetX: parseInt(m4[2], 10),
      offsetY: parseInt(m4[3], 10),
    }
  }

  // 구형 2필드(12~15라운드, 오프셋 도입 이전): width:url
  const m2 = remainder.match(/^(\d+):(.+)$/)
  if (m2) {
    return { text, imageUrl: m2[2], width: parseInt(m2[1], 10), offsetX: 0, offsetY: 0 }
  }

  // 최초 마커(10라운드, 폐기됨) — URL만, 너비·오프셋 전부 기본값
  return { text, imageUrl: remainder, width: DEFAULT_IMAGE_OVERLAY_WIDTH, offsetX: 0, offsetY: 0 }
}

/** 셀 값에 이미지(서명/직인) 오버레이 마커가 포함돼 있는지 판별 */
export function hasImageOverlay(value: unknown): value is string {
  return typeof value === 'string' && value.includes(IMAGE_CELL_PREFIX)
}

/** 기존 셀 텍스트 뒤에 이어붙일 이미지 오버레이 마커 문자열 생성 */
export function toImageOverlayMarker(
  url: string,
  width: number = DEFAULT_IMAGE_OVERLAY_WIDTH,
  offsetX = 0,
  offsetY = 0,
): string {
  return `${IMAGE_CELL_PREFIX}${width}:${offsetX}:${offsetY}:${url}`
}
