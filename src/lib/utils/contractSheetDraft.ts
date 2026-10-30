/**
 * contractSheetDraft.ts — 스프레드시트형 계약서 양식 "임시저장"(브라우저 localStorage, 2026-10-29)
 *
 * 저장하지 않은 편집 내용을 이 브라우저에만 잠깐 보관해, 네트워크 끊김·새로고침·탭 닫힘·브라우저 종료 뒤에도
 * 복구할 수 있게 한다. 서버(DB)에는 아무것도 보내지 않는다. 양식마다 따로(양식 id 또는 'new') 한 건만 둔다.
 * 저장소를 못 쓰거나(시크릿 모드·차단) 용량을 넘으면 조용히 건너뛰고 결과 코드로만 알린다 — 편집 자체는 계속된다.
 */
import { isSpreadsheetDocument, type SpreadsheetDocument } from '$lib/types/contract-document'

const KEY_PREFIX = 'cs-contract-sheet-draft:v1:'
/** 임시저장 보관 기간(밀리초) — 지나면 복구 제안하지 않고 지운다 */
export const SHEET_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 임시저장 1건의 최대 글자 수 — localStorage 용량(보통 5MB)을 다른 데이터와 나눠 쓰므로 여유를 둔다 */
export const SHEET_DRAFT_MAX_CHARS = 2_000_000

export interface SheetDraft {
  /** 임시저장한 시각(ms, epoch) */
  savedAt: number
  title: string
  doc: SpreadsheetDocument
}

export type SheetDraftSaveResult = 'ok' | 'too-large' | 'unavailable'

function keyOf(templateId: string): string {
  return `${KEY_PREFIX}${templateId || 'new'}`
}

/** 시트 하나의 구조가 편집기가 기대하는 모양인지(손상된 값이 편집기를 깨뜨리지 않도록) */
function isValidSheet(sheet: unknown): boolean {
  if (typeof sheet !== 'object' || sheet === null) return false
  const s = sheet as Record<string, unknown>
  return (
    typeof s['name'] === 'string' &&
    Array.isArray(s['rows']) &&
    (s['rows'] as unknown[]).every((r) => Array.isArray(r)) &&
    Array.isArray(s['merges']) &&
    Array.isArray(s['colWidths']) &&
    Array.isArray(s['cellFormatting'])
  )
}

export function isValidDraftDocument(doc: unknown): doc is SpreadsheetDocument {
  return isSpreadsheetDocument(doc) && doc.sheets.length > 0 && doc.sheets.every(isValidSheet)
}

export function saveSheetDraft(templateId: string, draft: { title: string; doc: SpreadsheetDocument }): SheetDraftSaveResult {
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), title: draft.title, doc: draft.doc } satisfies SheetDraft)
    if (payload.length > SHEET_DRAFT_MAX_CHARS) return 'too-large'
    localStorage.setItem(keyOf(templateId), payload)
    return 'ok'
  } catch {
    return 'unavailable' // 저장소 접근 불가·용량 초과
  }
}

/**
 * 임시저장을 읽는다. 없거나 손상됐거나 오래됐으면(또는 DB 저장본보다 오래됐으면) null 을 돌려주고 해당 값은 지운다.
 * @param notBefore 이 시각(ms)보다 먼저 저장된 임시저장은 이미 DB에 반영된 것으로 보고 버린다(양식의 마지막 저장 시각)
 */
export function loadSheetDraft(templateId: string, opts: { notBefore?: number; now?: number } = {}): SheetDraft | null {
  const key = keyOf(templateId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
    const savedAt = typeof p['savedAt'] === 'number' ? p['savedAt'] : 0
    const now = opts.now ?? Date.now()
    const stale = !savedAt || now - savedAt > SHEET_DRAFT_MAX_AGE_MS || savedAt <= (opts.notBefore ?? 0)
    if (stale || typeof p['title'] !== 'string' || !isValidDraftDocument(p['doc'])) {
      localStorage.removeItem(key)
      return null
    }
    return { savedAt, title: p['title'], doc: p['doc'] }
  } catch {
    return null
  }
}

export function clearSheetDraft(templateId: string): void {
  try {
    localStorage.removeItem(keyOf(templateId))
  } catch {
    /* 저장소 접근 불가 — 지울 것도 없다 */
  }
}
