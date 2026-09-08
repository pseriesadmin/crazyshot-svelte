import type { ContentBlock } from '$lib/types/content-editor'
import type { TiptapDocBlock, SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import type { ContractSubstitutionData, ContractLineItem } from '$lib/types/contract-module'
import type { SheetMergeRange } from '$lib/types/sheet-format'
import { substituteTiptapDoc } from '$lib/utils/tiptapRender'
import { escapeHtml } from '$lib/utils/spreadsheetRender'

// ─────────────────────────────────────────────────────────────────────────────
// 스칼라 치환 (배열 필드 스킵 — 반복 영역에서 별도 처리)
// ─────────────────────────────────────────────────────────────────────────────

function applySubstitution(text: string, data: ContractSubstitutionData): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractSubstitutionData
    const value = data[trimmed]
    // 스칼라(string)만 1:1 치환 — 배열(상품목록 등 반복영역 전용)은 Stage 2에서 별도 처리
    if (typeof value === 'string') return value
    return match
  })
}

/**
 * 반복영역 잉여 슬롯(미리 준비된 템플릿 행 수가 실제 항목 수보다 많을 때, 항목이 없는
 * 나머지 행)의 변수 자리를 공백으로 치환한다 — 2026-09-03, Stephen 확정: "항목 수만큼만
 * 반영하고 나머지 빈 반복 셀은 그냥 비워두면 된다". 이전 항목의 값이 남거나 {{}} 원문이
 * 그대로 노출되는 것을 방지한다.
 */
function blankVariables(text: string): string {
  return text.replace(/\{\{[^}]+\}\}/g, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// 항목별 치환 (반복 영역 전용)
// 1순위: ContractLineItem 필드(상품명·상품코드·수량·금액·비고)
// 2순위: 스칼라 폴백 (applySubstitution)
// ─────────────────────────────────────────────────────────────────────────────

function applyItemSubstitution(
  text: string,
  item: ContractLineItem,
  data: ContractSubstitutionData,
): string {
  // 1순위: 항목 필드 치환
  const withItem = text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractLineItem
    const value = item[trimmed]
    if (value !== undefined && typeof value === 'string') return value
    return match // 항목 필드에 없으면 원문 유지 → 2순위로 넘김
  })
  // 2순위: 스칼라 폴백
  return applySubstitution(withItem, data)
}

// ─────────────────────────────────────────────────────────────────────────────
// 병합 범위 처리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * repeatRegion 확장에 따라 merges 배열을 재계산한다.
 * - before region: 유지
 * - within region: 각 항목 행(startRow + i)에 인트라-행 span 복제 (cross-row merge는 드롭)
 * - after region: rowDelta(N - T) 만큼 행 인덱스 이동
 */
function expandMerges(
  merges: SheetMergeRange[],
  startRow: number,
  endRow: number,
  N: number,
  T: number,
): SheetMergeRange[] {
  const rowDelta = N - T
  const result: SheetMergeRange[] = []

  for (const merge of merges) {
    if (merge.e.r < startRow) {
      // ── before region: 변경 없음
      result.push(merge)
    } else if (merge.s.r > endRow) {
      // ── after region: 행 인덱스 보정
      result.push({
        s: { r: merge.s.r + rowDelta, c: merge.s.c },
        e: { r: merge.e.r + rowDelta, c: merge.e.c },
      })
    } else {
      // ── within region: 각 항목 행에 복제
      // 템플릿 안에서의 행 오프셋 (0-indexed)
      const templateRow = merge.s.r - startRow
      // cross-row merge (행을 넘는 병합)는 무시 — 단일 행 colspan만 복제
      const rowSpan = merge.e.r - merge.s.r
      for (let i = 0; i < N; i++) {
        // 이 항목이 이 템플릿 행을 사용하는가?
        if (Math.min(i, T - 1) === templateRow) {
          result.push({
            s: { r: startRow + i, c: merge.s.c },
            e: { r: startRow + i + rowSpan, c: merge.e.c },
          })
        }
      }
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 시트 단위 확장
// ─────────────────────────────────────────────────────────────────────────────

function expandSheet(sheet: SpreadsheetSheet, data: ContractSubstitutionData): SpreadsheetSheet {
  const { repeatRegion } = sheet
  const items = data.상품목록

  // ── repeatRegion 없거나 items 미정의: 기존 1:1 스칼라 치환 동작 유지 ──────
  if (!repeatRegion || items === undefined) {
    return {
      ...sheet,
      rows: sheet.rows.map((row) => row.map((cell) => applySubstitution(cell, data))),
    }
  }

  const { startRow, endRow } = repeatRegion
  const T = endRow - startRow + 1 // 템플릿 행 수
  const N = items.length           // 항목 수 (0 포함)

  // ── 행·서식 분리 ─────────────────────────────────────────────────────────
  const beforeRows = sheet.rows.slice(0, startRow)
  const templateRows = sheet.rows.slice(startRow, endRow + 1)
  const afterRows = sheet.rows.slice(endRow + 1)

  const beforeFmt = sheet.cellFormatting.slice(0, startRow)
  const templateFmt = sheet.cellFormatting.slice(startRow, endRow + 1)
  const afterFmt = sheet.cellFormatting.slice(endRow + 1)

  // ── before / after 스칼라 치환 ──────────────────────────────────────────
  const substitutedBefore = beforeRows.map((row) => row.map((cell) => applySubstitution(cell, data)))
  const substitutedAfter = afterRows.map((row) => row.map((cell) => applySubstitution(cell, data)))

  // ── 항목수(N) ≤ 템플릿행수(T): 템플릿 행 수를 그대로 유지 ──────────────────
  // 2026-09-03 Stephen 확정: 항목 수가 미리 준비된 반복 슬롯보다 적어도 뒤쪽 행을
  // 통째로 없애지(shrink) 않는다 — 앞쪽 N행만 실제 항목으로 채우고 나머지(T-N)행은
  // 변수 자리만 공백 처리한 채 그대로 남긴다. 문서의 전체 행 수·인쇄 레이아웃이 항목
  // 수와 무관하게 항상 고정되도록 하기 위함(이전엔 N행으로 축소돼 이후 정적 영역까지
  // 위로 밀려 올라갔음 — E-1/E-3 테스트 케이스가 이 이전 동작을 검증하고 있었으나
  // 새 스펙에 맞춰 함께 갱신함). 행 수·위치가 전혀 바뀌지 않으므로 merges도 원본 그대로
  // 유지한다(expandMerges 재계산 불필요 — rowDelta가 항상 0).
  if (N <= T) {
    const filledRows: string[][] = templateRows.map((row, i) =>
      i < N
        ? row.map((cell) => applyItemSubstitution(cell, items[i], data))
        : row.map((cell) => blankVariables(cell)),
    )
    return {
      ...sheet,
      rows: [...substitutedBefore, ...filledRows, ...substitutedAfter],
      cellFormatting: [...beforeFmt, ...templateFmt, ...afterFmt],
      merges: sheet.merges,
    }
  }

  // ── 항목수(N) > 템플릿행수(T): 기존 오버플로우 확장 동작 유지 ──────────────
  // 항목 i → 템플릿 행 min(i, T-1): 마지막 템플릿 행 서식을 재사용해 행을 추가한다.
  const expandedRows: string[][] = items.map((item, i) =>
    templateRows[Math.min(i, T - 1)].map((cell) => applyItemSubstitution(cell, item, data)),
  )
  const expandedFmt = items.map((_, i) => templateFmt[Math.min(i, T - 1)] ?? [])

  // ── 병합 범위 재계산 ─────────────────────────────────────────────────────
  const newMerges = expandMerges(sheet.merges, startRow, endRow, N, T)

  return {
    ...sheet,
    rows: [...substitutedBefore, ...expandedRows, ...substitutedAfter],
    cellFormatting: [...beforeFmt, ...expandedFmt, ...afterFmt],
    merges: newMerges,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────────────────────

/** content_blocks 배열에 포함될 수 있는 블록 타입 (레거시 + TipTap) */
export type AnyContentBlock = ContentBlock | TiptapDocBlock

/**
 * SpreadsheetDocument의 모든 셀 텍스트에서 {{변수명}} 패턴을 ContractSubstitutionData
 * 의 실제 값으로 치환한다. 치환하지 못한 변수는 {{변수명}} 원문을 그대로 유지.
 *
 * repeatRegion이 정의된 시트는 data.상품목록 배열 항목 수만큼 반복 행을 확장한다.
 * 원본 문서를 변경하지 않고 새 SpreadsheetDocument를 반환한다(immutable 처리).
 */
export function substituteSpreadsheetDocument(
  doc: SpreadsheetDocument,
  data: ContractSubstitutionData,
): SpreadsheetDocument {
  return {
    ...doc,
    sheets: doc.sheets.map((sheet) => expandSheet(sheet, data)),
  }
}

/**
 * content_blocks 배열의 변수 치환.
 * - 레거시 ContentBlock(text/html): {{변수명}} 정규식 치환
 * - tiptap-doc 블록: mergeField 노드를 실제 값으로 치환 (substituteTiptapDoc 위임)
 * - 기타 블록(divider 등): 그대로 반환
 */
export function substituteVariables(
  blocks: AnyContentBlock[],
  data: ContractSubstitutionData
): AnyContentBlock[] {
  return blocks.map((block): AnyContentBlock => {
    if (block.type === 'tiptap-doc') {
      return { ...block, doc: substituteTiptapDoc(block.doc, data) }
    }
    if (block.type === 'text') {
      return { ...block, html: applySubstitution(block.html, data) }
    }
    if (block.type === 'html') {
      return { ...block, content: applySubstitution(block.content, data) }
    }
    return block
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML형(고정 템플릿) 계약서 치환
//
// 보안 원칙: 모든 사용자 입력(고객이름·주소·상품명 등)을 escapeHtml()로 필수 이스케이프.
// XSS 방어의 유일한 서버측 장벽이다 — 이 함수를 거치지 않고 html_document에 사용자
// 입력값을 삽입하는 경로를 절대로 추가하지 말 것.
//
// 반복 영역: <!--REPEAT:상품목록-->...<!--/REPEAT--> HTML 주석 마커로 지정.
// 마커 사이 HTML 조각을 ContractSubstitutionData.상품목록 배열 항목 수만큼 복제·치환한다.
// N=0 이면 마커만 제거하고 행 없음. N≥1 이면 각 행마다 {{NO.}}(1-based)·항목 필드 치환.
// ─────────────────────────────────────────────────────────────────────────────

const REPEAT_MARKER_RE = /<!--REPEAT:상품목록-->([\s\S]*?)<!--\/REPEAT-->/g

// 발행자(대표이사) 서명·직인 이미지 마커(Migration #450) — <!--REPEAT-->와 동일하게 HTML
// 주석으로 지정해 원본 마크업을 깨지 않는다. 값은 contract_templates.html_issuer_signature_url
// (관리자가 CMS "서명/직인 삽입" 팝오버로 선택 — cms_signature_assets.image_url 그대로 복사).
// http(s) 절대 URL만 허용(스킴 인젝션 방지, spreadsheetRender.ts SAFE_IMAGE_URL과 동일 원칙).
const ISSUER_SIGNATURE_MARKER = '<!--ISSUER_SIGNATURE-->'
const SAFE_SIGNATURE_URL = /^https?:\/\//i

/** 스프레드시트형 이미지 크기조절 툴바(ContractSpreadsheetEditor.svelte)와 동일한 클램프 범위·기본값 */
const ISSUER_SIGNATURE_MIN_WIDTH = 20
const ISSUER_SIGNATURE_MAX_WIDTH = 1200
const ISSUER_SIGNATURE_DEFAULT_WIDTH = 90

/**
 * 위치 이동(드래그) 오프셋(px) 허용 범위(Migration #463, 2026-09-08) — 문서 전체 어디로든
 * 옮길 수 있어야 하므로 매우 넓게 잡되(§ Stephen "문서 전체 어디든 자유 이동" 확정),
 * 비정상적으로 큰 값이 실수로 저장돼 인쇄 레이아웃을 완전히 벗어나는 사고를 막기 위한
 * 최소한의 안전장치로만 클램프한다.
 */
const ISSUER_SIGNATURE_OFFSET_LIMIT = 2000

/**
 * 발행자 서명·직인 이미지 마커를 실제 <img> 태그(또는 미지정 시 빈 문자열)로 치환한다.
 * {{변수명}} 치환과 완전히 분리된 별도 패스 — ContractTemplatePanel.svelte의 관리자 편집
 * 미리보기(변수 미치환 상태)에서도 독립적으로 호출해 서명 삽입 결과만 즉시 확인할 수 있다.
 * url은 관리자가 CMS에서 선택한 값(고객 입력 아님)이지만, 속성 인젝션 방지를 위해 그래도
 * escapeHtml()로 감싼다.
 *
 * width(px)는 스프레드시트형 크기조절 툴바(소(100)/중(200)/대(400) + 커스텀 입력)와 동일한
 * 20~1200 범위로 클램프한다.
 *
 * offsetX/offsetY(px, Migration #463)는 이미지의 기본 중앙 위치(top:50%, left:50%,
 * translate(-50%,-50%)) 대비 이동 델타값이다 — 둘 다 미지정(또는 0)이면 기존과 완전히
 * 동일하게 셀 중앙에 표시되어 하위호환된다. `.sig-host-cell`(position:relative)이 이미
 * 이 이미지의 위치 기준점이고 그 조상 어디에도 overflow:hidden이 없으므로, translate에
 * 큰 오프셋을 더하는 것만으로 문서 전체 어디로든 자유롭게 이동한 것처럼 보이게 할 수 있다
 * (DOM 구조 자체는 그대로 유지 — 별도 레이어로 옮길 필요 없음).
 */
export function applyIssuerSignatureMarker(
  html: string,
  imageUrl: string | null | undefined,
  width?: number | null,
  offsetX?: number | null,
  offsetY?: number | null,
): string {
  if (!imageUrl || !SAFE_SIGNATURE_URL.test(imageUrl)) {
    return html.split(ISSUER_SIGNATURE_MARKER).join('')
  }
  const safeWidth = Math.min(
    ISSUER_SIGNATURE_MAX_WIDTH,
    Math.max(ISSUER_SIGNATURE_MIN_WIDTH, width && width > 0 ? Math.round(width) : ISSUER_SIGNATURE_DEFAULT_WIDTH),
  )
  const clampOffset = (v?: number | null): number =>
    Number.isFinite(v) ? Math.min(ISSUER_SIGNATURE_OFFSET_LIMIT, Math.max(-ISSUER_SIGNATURE_OFFSET_LIMIT, Math.round(v as number))) : 0
  const safeOffsetX = clampOffset(offsetX)
  const safeOffsetY = clampOffset(offsetY)
  const transform = `translate(calc(-50% + ${safeOffsetX}px), calc(-50% + ${safeOffsetY}px))`
  const replacement = `<img src="${escapeHtml(imageUrl)}" alt="발행자 직인" class="issuer-sig-overlay" style="width:${safeWidth}px; transform:${transform}" />`
  return html.split(ISSUER_SIGNATURE_MARKER).join(replacement)
}

// 예약자(고객) 서명 마커(2026-09-08 신설) — <!--ISSUER_SIGNATURE-->와 동일한 "주석으로
// 위치만 표시" 방식이지만, 값의 출처와 치환 시점이 다르다:
//   · 발행자 서명은 발행 시점(applySelectedTemplate)에 이미 알 수 있어 그때 1회 치환된다.
//   · 고객 서명은 발행 시점엔 존재하지 않는다(고객이 아직 서명 전) — 이 마커는 issuance
//     시점엔 그대로 보존되고, 고객이 실제로 서명을 제출한 시점(POST /api/contracts/
//     [token]/sign)에만 1회 호출돼 contracts.html_document에 되구워 넣어진다.
// 값은 고객이 /contract/[token]에서 그린 서명(SignatureCanvas.toDataURL('image/png'))이라
// 항상 "data:image/png;base64,..." 형태 — http(s) URL이 아니므로 SAFE_SIGNATURE_URL과는
// 별도의 data URI 전용 화이트리스트로 검증한다(콤마 이후 구간까지 base64 알파벳만 허용 —
// 접두사만 검사하면 그 뒤에 임의 문자열을 붙여 속성 인젝션이 가능해짐).
const CUSTOMER_SIGNATURE_MARKER = '<!--CUSTOMER_SIGNATURE-->'
const SAFE_SIGNATURE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/

/**
 * 고객(예약자) 서명 마커를 실제 <img>(또는 미지정·검증 실패 시 빈 문자열)로 치환한다.
 * 발행자 서명과 달리 클라이언트가 제출한 값(공개 서명 링크, 인증 없는 요청)이라
 * SAFE_SIGNATURE_DATA_URL 정규식으로 형식을 엄격히 검증한 뒤에도 escapeHtml()로 한 번 더
 * 감싄다(base64 알파벳엔 이스케이프 대상 문자가 없어 결과는 동일하지만, 발행자 서명 함수와
 * 동일한 방어 관행을 유지 — 나중에 형식이 바뀌어도 안전).
 */
export function applyCustomerSignatureMarker(
  html: string,
  signatureDataUrl: string | null | undefined,
): string {
  if (!signatureDataUrl || !SAFE_SIGNATURE_DATA_URL.test(signatureDataUrl)) {
    return html.split(CUSTOMER_SIGNATURE_MARKER).join('')
  }
  const replacement = `<img src="${escapeHtml(signatureDataUrl)}" alt="예약자 서명" class="customer-sig-overlay" />`
  return html.split(CUSTOMER_SIGNATURE_MARKER).join(replacement)
}

// 문서 진위확인 QR 마커(2026-09-08 신설) — 인쇄된 계약서를 스캔하면 그 계약서의 실제 온라인
// 사본(서명 링크/확인 페이지, /contract/[token])으로 바로 연결돼 원본 여부를 즉시 판별할 수
// 있게 한다(Stephen 확정 — products.md §2-4의 "QR=텍스트, 링크 아님" 정책과 달리, 이 QR은
// 의도적으로 링크형이다: 스캔 즉시 확인이 목적이므로 문자열만 담는 방식은 부적합).
// 값은 서버가 send-chat 시점에 생성한 data:image/png;base64 QR 이미지 — 고객 서명과 동일한
// 검증 정책(SAFE_SIGNATURE_DATA_URL, 콤마 이후 base64 알파벳만 허용)을 그대로 재사용한다.
const DOCUMENT_QR_MARKER = '<!--DOCUMENT_QR-->'

/**
 * 문서 진위확인 QR 마커를 실제 <img>(또는 미지정·검증 실패 시 빈 문자열)로 치환한다.
 * send-chat 시점에 서버가 QRCode.toDataURL()로 직접 생성한 값이라 사용자 입력은 아니지만,
 * 다른 base64 이미지 마커와 동일한 방어 관행(형식 검증 + escapeHtml)을 유지한다.
 */
export function applyDocumentQrMarker(
  html: string,
  qrDataUrl: string | null | undefined,
): string {
  if (!qrDataUrl || !SAFE_SIGNATURE_DATA_URL.test(qrDataUrl)) {
    return html.split(DOCUMENT_QR_MARKER).join('')
  }
  const replacement = `<img src="${escapeHtml(qrDataUrl)}" alt="계약서 진위확인 QR" class="doc-verify-qr" />`
  return html.split(DOCUMENT_QR_MARKER).join(replacement)
}

// 정산내역 "특이사항" 마커(2026-09-07 신설) — <!--ISSUER_SIGNATURE-->와 동일하게 HTML 주석으로
// 지정해 {{}} 변수 치환·findHtmlUnresolvedVariables 사전검증과 완전히 분리한다. 값은 새 필드를
// 만들지 않고 기존 "특약 조항" 패널(ContractFieldPanel.svelte 특약 탭, contracts.specifications)
// 을 그대로 재사용한다 — Stephen 확정: "기존 특약 조항 패널 재사용". 참고: 이 데이터는 원래
// /contract/[token] 서명 화면 맨 아래에 "특약 조항"이라는 별도 섹션으로도 항상 표시되는데(그
// 화면의 공용 렌더링, 모드 무관), 이 마커는 그와 별개로 정산내역 표 안의 "특이사항" 칸에도
// 같은 데이터를 인라인으로 보여주기 위한 것 — 하나를 없애고 다른 하나로 대체하는 것이 아니다.
const SPECIAL_NOTES_MARKER = '<!--SPECIAL_NOTES-->'

/**
 * "특약 조항"(specifications) 목록을 "key: value"쌍을 <br/>로 이어붙인 텍스트로 합친다.
 * 빈 배열/키 없는 항목은 제외 — 전부 없으면 &nbsp;(빈 칸 유지, 기존 하드코딩 동작과 시각적으로
 * 동일). applySpecialNotesMarker()와 updateSpecialNotesInHtml() 둘 다 이 포맷을 공유한다.
 */
function formatSpecialNotesText(
  specifications: { key: string; value: string }[] | null | undefined,
): string {
  const rows = (specifications ?? []).filter((s) => s.key?.trim())
  return rows.length === 0
    ? '&nbsp;'
    : rows.map((s) => `${escapeHtml(s.key)}: ${escapeHtml(s.value)}`).join('<br/>')
}

/**
 * "특약 조항"(specifications) 목록을 정산내역 "특이사항" 마커(`<!--SPECIAL_NOTES-->`)에
 * 채운다. 발행 시점(applySelectedTemplate)에 1회 호출돼 결과가 html_document에 그대로
 * 저장된다 — 마커 자체는 이 호출 이후 사라진다(재호출해도 마커가 없으면 아무 효과 없음).
 */
export function applySpecialNotesMarker(
  html: string,
  specifications: { key: string; value: string }[] | null | undefined,
): string {
  return html.split(SPECIAL_NOTES_MARKER).join(formatSpecialNotesText(specifications))
}

// 계약 발행 보기 화면에서 특약을 클릭 편집할 때 사용 — defaultRentalContractHtml.ts의
// `<td class="cs-special-notes-cell" ...>` 셀을 앵커로 찾는다(발행 시점에 이미
// `<!--SPECIAL_NOTES-->` 마커가 텍스트로 치환된 뒤라 applySpecialNotesMarker()를 그대로
// 재사용할 수 없음 — 마커가 이미 사라진 상태이므로 클래스명으로 위치를 다시 찾아야 함).
// formatSpecialNotesText()가 만드는 텍스트는 HTML 이스케이프돼 있어 `</td>`를 깨뜨릴 수
// 없으므로 non-greedy 매칭으로 안전하게 셀 내용만 교체 가능.
const SPECIAL_NOTES_CELL_REGEX = /(<td class="cs-special-notes-cell"[^>]*>)([\s\S]*?)(<\/td>)/

/**
 * 이미 발행된(=마커가 이미 치환된) html_document에서 특약 영역만 재교체한다. 2026-09-07
 * 이전에 발행된 계약서는 이 클래스 자체가 없어 아무 효과 없이 원본을 그대로 반환한다
 * (레거시 계약은 클릭 편집 UI 자체가 노출되지 않으므로 이 함수가 호출될 일도 없음).
 */
export function updateSpecialNotesInHtml(
  html: string,
  specifications: { key: string; value: string }[] | null | undefined,
): string {
  if (!SPECIAL_NOTES_CELL_REGEX.test(html)) return html
  return html.replace(SPECIAL_NOTES_CELL_REGEX, `$1${formatSpecialNotesText(specifications)}$3`)
}

// ─────────────────────────────────────────────────────────────────────────────
// "계약 및 인수 확인"·"개인정보동의" 마커(Migration #464, 2026-09-08 신설) — 지금까지
// defaultRentalContractHtml.ts에 <p> 문단으로 하드코딩돼 있어 관리자가 전혀 수정할 수
// 없던 두 섹션을 편집 가능하게 전환. 값은 contract_templates.contract_terms_text/
// privacy_terms_text(빈 줄로 문단 구분한 일반 텍스트) — NULL(미커스터마이즈)이면 지금까지의
// 기본 문구를 그대로 사용해 하위호환. 문단 맨 앞이 "[라벨]" 형태면 그 대괄호 부분만 자동으로
// <strong>처리한다 — 기존 하드코딩 문단의 <strong>[라벨]</strong>내용 관례를 그대로 재현.
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_TERMS_MARKER = '<!--CONTRACT_TERMS-->'
const PRIVACY_TERMS_MARKER  = '<!--PRIVACY_TERMS-->'

export const DEFAULT_CONTRACT_TERMS_TEXT =
`제반사고 및 사용상의 취급 부주의로 인한 장비손상에 대하여 배상의 책임을 집니다.

상품정보를 이상 없이 인수받았기에 아래와 같이 서명 날인합니다

※촬영(대여)전 크레이지샷 매장 내에서 구성품 확인,작동 이상유무 확인,테스트 촬영을 꼭 하시기 바랍니다.

※구성품 확인,작동 이상유무 확인,테스트 촬영을 하지 않았을 경우 본 촬영에 들어가 발생되는 모든 상황에 대해 크레이지샷은 책임을 지지 않습니다.

[비대면 인도 및 검수]회사는 장비의 정상 작동 여부를 확인한 후 택배 또는 퀵서비스로 발송하며,고객은 장비 수령 즉시 구성품 및 상태를 확인해야 합니다.

[하자 통보 의무]장비에 결함이 있거나 구성품이 누락된 경우,고객은 수령 후[3시간]이내에 사진 또는 영상과 함께 회사에 통보해야 합니다.

[인도 완료 의제]위 기한 내에 별도의 이의제기가 없는 경우,고객이 장비를 이상 없는 상태로 인도받은 것으로 간주하며 이후 발생하는 모든 파손 및 기능 불능에 대한 책임은 고객에게 귀속됩니다.

[배송 중 사고]배송 과정에서 발생한 파손은 운송업체의 책임 규정에 따르되,고객이 수령 후 즉시 신고하지 않아 운송업체에 책임을 물을 수 없게 된 경우 그 손해는 고객이 배상합니다.

기타 계약조건은 당사 홈페이지(www.crazyshot.kr)의 이용약관을 참조하여 주십시오.`

export const DEFAULT_PRIVACY_TERMS_TEXT =
`[신원 검증]고가 장비 대여 시 본인 확인을 위해 신분증 및3개월 이내 등본 사본을 제출하며,위조 시 즉시 형사 고발됩니다.

[보안 관리]제출 서류는 암호화된 독립 저장소에 보관하며,정상 반납12개월 후 파기하되 분쟁 시에는 해결 시까지 보관합니다.

[법적 대응]장비 미반납·연락 두절 시 수집된 정보를 바탕으로 횡령 및 사기죄 고소를 진행하며,관련 정보를 수사기관에 제공합니다.`

/**
 * 빈 줄(연속 개행 1개 이상)로 문단을 나눈 일반 텍스트를 <p> 태그 목록으로 렌더링한다.
 * 문단 맨 앞이 "[라벨]" 형태면 그 부분만 <strong>으로 감싼다(기존 하드코딩 관례 재현).
 * escapeHtml()을 먼저 적용한 뒤 그 결과 문자열에서 대괄호 패턴을 찾으므로 XSS 안전.
 * @internal
 */
function renderTermsParagraphsHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const escaped = escapeHtml(p).replace(/\n/g, '<br/>')
      const m = escaped.match(/^(\[[^\]]+\])([\s\S]*)$/)
      return m ? `<p><strong>${m[1]}</strong>${m[2]}</p>` : `<p>${escaped}</p>`
    })
    .join('')
}

/** "계약 및 인수 확인" 마커를 문단 텍스트(또는 미지정 시 기본 문구)로 치환한다. */
export function applyContractTermsMarker(
  html: string,
  text: string | null | undefined,
): string {
  const body = renderTermsParagraphsHtml(text && text.trim() ? text : DEFAULT_CONTRACT_TERMS_TEXT)
  return html.split(CONTRACT_TERMS_MARKER).join(body)
}

/** "개인정보동의" 마커를 문단 텍스트(또는 미지정 시 기본 문구)로 치환한다. */
export function applyPrivacyTermsMarker(
  html: string,
  text: string | null | undefined,
): string {
  const body = renderTermsParagraphsHtml(text && text.trim() ? text : DEFAULT_PRIVACY_TERMS_TEXT)
  return html.split(PRIVACY_TERMS_MARKER).join(body)
}

/**
 * HTML형 계약서의 스칼라 변수 치환 (XSS 이스케이프 적용).
 * @internal
 */
function applyHtmlSubstitution(text: string, data: ContractSubstitutionData): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractSubstitutionData
    const value = data[trimmed]
    // 스칼라(string)만 치환 — 배열(상품목록)은 반복 영역에서 별도 처리
    if (typeof value === 'string') return escapeHtml(value)
    // 치환 불가 변수 → 빈 문자열(원문 제거)
    return ''
  })
}

/**
 * 반복 행 안에서 ContractLineItem 필드 우선 치환 후 스칼라 폴백 치환 (XSS 이스케이프 적용).
 * {{NO.}} 는 1-based 순번으로 치환한다.
 * @internal
 */
function applyHtmlItemSubstitution(
  text: string,
  item: ContractLineItem,
  data: ContractSubstitutionData,
  index: number,
): string {
  // 1순위: 순번 {{NO.}} 및 ContractLineItem 필드
  const withItem = text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim()
    // {{NO.}} → 1-based 순번
    if (trimmed === 'NO.' || trimmed === 'NO') return String(index + 1)
    // ContractLineItem 필드
    const itemValue = item[trimmed as keyof ContractLineItem]
    if (itemValue !== undefined && typeof itemValue === 'string') return escapeHtml(itemValue)
    return match // 항목 필드에 없으면 원문 유지 → 2순위 스칼라 폴백
  })
  // 2순위: 스칼라 폴백 (ContractSubstitutionData, 이스케이프 포함)
  return applyHtmlSubstitution(withItem, data)
}

/**
 * HTML형(고정 템플릿) 계약서의 변수 치환.
 *
 * 1. <!--REPEAT:상품목록-->...<!--/REPEAT--> 반복 영역: 상품목록 배열 항목 수만큼 확장 후 치환.
 * 2. 나머지 영역: 스칼라 변수 1:1 치환.
 * 3. 모든 치환값은 escapeHtml()로 이스케이프 (XSS 방어).
 * 4. 치환 불가 변수(키가 ContractSubstitutionData에 없음)는 빈 문자열로 대체(원문 제거).
 *
 * @param html  변수 치환 전 HTML 원본 (DEFAULT_RENTAL_CONTRACT_HTML 등)
 * @param data  치환 데이터 (ContractSubstitutionData)
 * @returns     치환 완료된 HTML — DB 저장 및 {@html} 렌더링에 안전
 */
export function substituteHtmlDocument(
  html: string,
  data: ContractSubstitutionData,
): string {
  const items = data.상품목록 ?? []

  // 반복 영역 처리
  const withRepeat = html.replace(REPEAT_MARKER_RE, (_match, innerTemplate: string) => {
    if (items.length === 0) return ''
    return items
      .map((item, i) => applyHtmlItemSubstitution(innerTemplate, item, data, i))
      .join('')
  })

  // 나머지 스칼라 치환
  return applyHtmlSubstitution(withRepeat, data)
}

// ─────────────────────────────────────────────────────────────────────────────
// CS2654 보완 — 발송 전 잔존/치환불가 변수 탐지 (CMS 전역 정밀검증 v6, 2026-09-07)
// ─────────────────────────────────────────────────────────────────────────────

const RESIDUAL_VAR_RE = /\{\{([^}]+)\}\}/g

/**
 * 이미 저장된 계약서 콘텐츠(authoring_mode 무관 — content_blocks/spreadsheet_document/
 * html_document/canvas_document 아무거나)에서 아직 {{변수명}} 원문으로 남아있는 값을
 * 전부 찾아 중복 제거된 변수명 목록으로 반환한다. 발송 직전 최종 안전장치(send-chat).
 *
 * ⚠️ html 모드는 치환 실패 시 applyHtmlSubstitution이 빈 문자열로 조용히 삭제하므로
 * (§HT-6, 의도된 사양) 저장 이후 시점에서는 이 스캔으로 잡히지 않는다 — html 모드의
 * 사전 검증은 findHtmlUnresolvedVariables()(치환 전 원본 템플릿 대상)를 별도로 쓴다.
 */
export function findUnresolvedVariables(content: unknown): string[] {
  if (content == null) return []
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  const found = new Set<string>()
  for (const match of text.matchAll(RESIDUAL_VAR_RE)) {
    found.add(match[1].trim())
  }
  return [...found]
}

/**
 * HTML형 원본 템플릿(치환 전)을 대상으로, ContractSubstitutionData에 값이 없어(스칼라
 * string이 아니어서) applyHtmlSubstitution이 빈 문자열로 지워버릴 변수명을 미리 찾아
 * 중복 제거된 목록으로 반환한다. 저장/발송 전에 호출해 발송을 막는 용도(클라이언트 측
 * 사전 검증) — substituteHtmlDocument 자체의 반환 시그니처는 기존 호출부·테스트(HT-1~7)
 * 보호를 위해 변경하지 않는다.
 *
 * ⚠️ 2026-09-07 발견·수정 — <!--REPEAT:상품목록--> 반복영역 내부의 변수(NO./상품명/
 * 상품코드/수량/금액/비고)는 ContractSubstitutionData의 최상위 키가 아니라
 * ContractLineItem(배열 각 항목)의 필드다. substituteHtmlDocument()는 이 영역을
 * applyHtmlItemSubstitution()으로 별도 처리(1순위 item 필드 → 2순위 스칼라 폴백 →
 * 그래도 없으면 빈 문자열)하므로 실제 치환 시 잔존 `{{}}` 텍스트가 절대 남지 않는데,
 * 이 사전검증 함수는 반복영역도 최상위 스칼라 검사 로직을 그대로 적용해 `data.금액`·
 * `data.비고`(ContractSubstitutionData에 존재하지 않는 키)를 "누락"으로 오탐했다
 * (상품명/상품코드/수량은 마침 최상위에도 동명의 하위호환 필드가 있어 우연히 통과됨).
 * 그 결과 실사용 중 정상적으로 작성된 계약서도 "금액, 비고 항목이 채워지지 않았다"며
 * 발송이 막히는 실사용 버그로 이어졌다(Stephen 제보) — 반복영역 내부는 사전검증 대상에서
 * 제외(반복영역은 substituteHtmlDocument의 자체 폴백 로직이 항상 안전하게 처리함).
 */
export function findHtmlUnresolvedVariables(
  html: string,
  data: ContractSubstitutionData,
): string[] {
  // 반복영역 내부 변수는 ContractLineItem 필드 기준으로 별도 처리되어 항상 안전하게
  // 치환되므로(위 주석 참고), 최상위 스칼라 검사 대상에서 완전히 제외한다.
  const withoutRepeat = html.replace(REPEAT_MARKER_RE, '')
  const found = new Set<string>()
  for (const match of withoutRepeat.matchAll(RESIDUAL_VAR_RE)) {
    const key = match[1].trim()
    if (key === 'NO.' || key === 'NO') continue // 반복영역 순번은 항상 치환됨
    if (typeof data[key as keyof ContractSubstitutionData] !== 'string') found.add(key)
  }
  return [...found]
}
