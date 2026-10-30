/**
 * rhwpPreview.ts — 한글 문서 가져오기 보조: 원본 미리보기(쪽 그림) + 누름틀 → 계약 변수 연결 (한글 엔진 rhwp)
 *
 * 쓰는 곳: ContractImportModal(.hwp/.hwpx 가져오기). 본문 변환은 기존 변환기(hwp-convert)가 그대로 맡고, 이 모듈은 보조만 한다.
 * 엔진 모듈은 호출부가 넘긴다(loadRhwp 결과) — 브라우저·Node(테스트) 어디서든 같은 코드로 돈다.
 *
 * 누름틀 연결 방식(2026-10-29 실험): 연결한 누름틀의 값을 엔진에서 `{{변수명}}`으로 채우고 HWP 로 저장(exportHwp)한 뒤
 *   기존 변환기가 읽게 한다. HWPX 가 아니라 HWP 로 넘기는 이유 — 엔진이 만든 HWPX 는 표가 `ctrl` 과 같은 줄에 들어 있어
 *   기존 변환기가 그 줄의 표까지 건너뛰는 사례가 있었다(위치기반서비스사업(변경)신고.hwp).
 * 같은 이름의 누름틀이 여러 곳이면 필드 번호(fieldId)로 하나씩 채운다(이름 기준 API 는 첫 번째만 채운다).
 * 목차 같은 곳의 누름틀은 본문 글에 나타나지 않아 채워도 반영되지 않는다 → "반영 안 됨"으로 보고한다.
 */
import type { RhwpModule } from './rhwpLoader'

export interface HwpFieldGroup {
  /** 누름틀 이름 */
  name: string
  /** 같은 이름을 가진 필드 번호들(문서 순서) */
  fieldIds: number[]
}

export interface HwpVariableExport {
  /** 변수 토큰을 채운 HWP 바이트 — 기존 변환기에 넘긴다 */
  bytes: Uint8Array
  /** 채운 필드 수 */
  applied: number
  /** 채웠지만 본문 글에 나타나지 않은 누름틀 이름(목차·머리말 안 등) */
  unreflected: string[]
}

export interface HwpPreviewSession {
  pageCount: number
  fieldGroups: HwpFieldGroup[]
  /** 쪽(0부터)의 그림(SVG 문자열). 화면에는 반드시 이미지(blob URL)로만 넣는다 — svgToObjectUrl */
  renderPageSvg(pageIndex: number): string
  exportWithVariables(mapping: Record<string, string>): HwpVariableExport
  /** 엔진 문서를 해제한다(WASM 메모리는 자동 회수되지 않는다) */
  close(): void
}

/** 변수 이름으로 허용하는 모양 — 중괄호·줄바꿈 금지(토큰 `{{…}}` 구조를 깨는 입력 차단) */
const VARIABLE_NAME = /^[^{}\r\n]{1,60}$/

export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME.test(name) && name.trim() === name && name.length > 0
}

function listClickHereFields(rh: RhwpModule, bytes: Uint8Array): { doc: InstanceType<RhwpModule['HwpDocument']>; groups: HwpFieldGroup[] } {
  const doc = new rh.HwpDocument(bytes)
  let list: unknown
  try {
    list = JSON.parse(doc.getFieldList())
  } catch {
    list = []
  }
  const groups: HwpFieldGroup[] = []
  const byName = new Map<string, HwpFieldGroup>()
  if (Array.isArray(list)) {
    for (const f of list as Array<{ fieldType?: string; name?: string; fieldId?: number }>) {
      if (String(f.fieldType ?? '').toLowerCase() !== 'clickhere') continue
      const name = String(f.name ?? '').trim()
      if (!name || typeof f.fieldId !== 'number') continue
      let g = byName.get(name)
      if (!g) {
        g = { name, fieldIds: [] }
        byName.set(name, g)
        groups.push(g)
      }
      g.fieldIds.push(f.fieldId)
    }
  }
  return { doc, groups }
}

/** 한글 파일을 열어 쪽 수·누름틀 목록을 얻고, 쪽 그림을 그릴 수 있는 세션을 돌려준다. */
export function openHwpPreview(rh: RhwpModule, bytes: Uint8Array): HwpPreviewSession {
  const { doc, groups } = listClickHereFields(rh, bytes)
  let pageCount: number
  try {
    pageCount = doc.pageCount()
  } catch (e) {
    doc.free() // 쪽 수를 못 읽으면 세션을 만들지 못하므로 문서 핸들을 여기서 해제한다
    throw e
  }
  let closed = false
  return {
    pageCount,
    fieldGroups: groups,
    renderPageSvg(pageIndex: number): string {
      if (closed) throw new Error('이미 닫힌 미리보기입니다.')
      return doc.renderPageSvg(pageIndex)
    },
    exportWithVariables(mapping: Record<string, string>): HwpVariableExport {
      // 원본 바이트에서 새로 열어 채운다 — 연결을 바꿔 다시 만들어도 이전 값이 남지 않는다
      const work = new rh.HwpDocument(bytes)
      try {
        const wanted = groups.filter((g) => {
          const v = mapping[g.name]
          return typeof v === 'string' && isValidVariableName(v)
        })
        let applied = 0
        for (const g of wanted) {
          for (const id of g.fieldIds) {
            const r = JSON.parse(work.setFieldValue(id, `{{${mapping[g.name]}}}`)) as { ok?: boolean }
            if (r.ok) applied += 1
          }
        }
        const text = String(JSON.parse(work.getTextFileUnicode()))
        const unreflected = wanted.filter((g) => !text.includes(`{{${mapping[g.name]}}}`)).map((g) => g.name)
        const exported = work.exportHwpWithReport()
        try {
          return { bytes: exported.takeBytes(), applied, unreflected }
        } finally {
          exported.free()
        }
      } finally {
        work.free()
      }
    },
    close(): void {
      if (closed) return
      closed = true
      doc.free()
    },
  }
}

/**
 * SVG 문자열을 이미지 주소(blob URL)로 만든다. ⛔ SVG 를 {@html} 로 화면에 넣지 않는다(저장형 XSS 방지) —
 * <img src=blob:...> 로 로드된 SVG 는 스크립트가 실행되지 않는다. 쓴 뒤에는 URL.revokeObjectURL 로 해제한다.
 */
export function svgToObjectUrl(svg: string): string {
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
}

// ── 누름틀 이름 → 계약 변수 자동 제안 ─────────────────────────────────────

const SYNONYMS: Record<string, string[]> = {
  고객이름: ['성명', '이름', '고객명', '계약자', '계약자명', '임차인', '임차인명', '신청자', '신청인', '대표자'],
  연락처: ['전화번호', '전화', '휴대폰', '휴대전화', '핸드폰', '연락처', '휴대폰번호'],
  이메일: ['이메일', 'email', '메일', '이메일주소'],
  주소: ['주소', '소재지', '거주지', '주소지'],
  상품명: ['상품명', '품명', '장비명', '물품명', '대여물품', '대여품목'],
  상품코드: ['상품코드', '품번', '장비번호'],
  예약코드: ['예약번호', '예약코드', '계약번호'],
  수령일시: ['수령일시', '대여시작', '대여시작일', '대여일시'],
  반납일시: ['반납일시', '대여종료', '대여종료일', '반납일'],
  최종합계: ['합계', '총액', '총금액', '합계금액', '대여료합계'],
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_\-:()[\]/.·]/g, '')
}

/** 누름틀 이름과 같거나 비슷한 계약 변수가 있으면 그 이름을 돌려준다(제안일 뿐 — 사용자가 바꿀 수 있다). */
export function suggestVariable(fieldName: string, variables: readonly string[]): string | null {
  const n = normalize(fieldName)
  if (!n) return null
  const exact = variables.find((v) => normalize(v) === n)
  if (exact) return exact
  for (const [variable, names] of Object.entries(SYNONYMS)) {
    if (variables.includes(variable) && names.some((x) => normalize(x) === n)) return variable
  }
  return null
}
