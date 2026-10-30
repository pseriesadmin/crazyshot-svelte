/**
 * contractModeDraft.ts — 문서형(flow)·HTML형(html) 계약서 양식 "임시저장"(브라우저 localStorage, 2026-10-29)
 *
 * 스프레드시트형의 contractSheetDraft.ts 와 같은 원리 — 저장하지 않은 편집 내용을 이 브라우저에만 잠깐 보관해, 네트워크 끊김·새로고침·탭 닫힘 뒤에
 * 복구할 수 있게 한다. 서버로는 아무것도 보내지 않는다. 양식(id 또는 'new')·방식(flow/html)마다 한 건.
 * 문서형은 가져온 문서의 그림이 본문에 데이터로 박혀 커질 수 있어 용량 한도를 두고, 넘으면 저장하지 않고 'too-large' 로 알린다
 * (이때 오래된 임시저장은 지워 낡은 내용이 복구 제안되는 일을 막는다). HTML형은 데이터가 작다.
 */
import type { JSONContent } from '@tiptap/core'

const KEY_PREFIX = 'cs-contract-mode-draft:v1:'
/** 임시저장 보관 기간 — 지나면 복구 제안하지 않고 지운다 */
export const MODE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 문서형 임시저장 1건의 최대 글자 수(그림이 데이터로 박힌 본문이 커지는 것을 막는다) */
export const FLOW_DRAFT_MAX_CHARS = 1_500_000
/** HTML형 임시저장 1건의 최대 글자 수 */
export const HTML_DRAFT_MAX_CHARS = 300_000

export type ModeDraftKind = 'flow' | 'html'

export interface HtmlDraftFields {
  signatureUrl: string | null
  signatureWidth: number | null
  signatureOffsetX: number | null
  signatureOffsetY: number | null
  contractTerms: string
  privacyTerms: string
}

export interface ModeDraft {
  savedAt: number
  kind: ModeDraftKind
  title: string
  /** 특약 목록(JSON 문자열) */
  specsJson: string
  requiresIssuerSignature: boolean
  /** 문서형 본문(TipTap JSON) */
  flowDoc?: JSONContent
  /** HTML형 입력 항목 */
  html?: HtmlDraftFields
}

export type ModeDraftSaveResult = 'ok' | 'too-large' | 'unavailable'

const keyOf = (kind: ModeDraftKind, templateId: string): string => `${KEY_PREFIX}${kind}:${templateId || 'new'}`

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isValidDraft(p: unknown, kind: ModeDraftKind): p is ModeDraft {
  if (!isRecord(p)) return false
  if (typeof p['savedAt'] !== 'number' || p['kind'] !== kind || typeof p['title'] !== 'string') return false
  if (typeof p['specsJson'] !== 'string' || typeof p['requiresIssuerSignature'] !== 'boolean') return false
  if (kind === 'flow') {
    const doc = p['flowDoc']
    return isRecord(doc) && typeof doc['type'] === 'string'
  }
  const h = p['html']
  return isRecord(h) && typeof h['contractTerms'] === 'string' && typeof h['privacyTerms'] === 'string'
}

export function saveModeDraft(templateId: string, draft: Omit<ModeDraft, 'savedAt'>): ModeDraftSaveResult {
  const key = keyOf(draft.kind, templateId)
  try {
    const payload = JSON.stringify({ ...draft, savedAt: Date.now() })
    const cap = draft.kind === 'flow' ? FLOW_DRAFT_MAX_CHARS : HTML_DRAFT_MAX_CHARS
    if (payload.length > cap) {
      localStorage.removeItem(key) // 낡은 임시저장이 복구 제안되지 않게
      return 'too-large'
    }
    localStorage.setItem(key, payload)
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

/** 없거나 손상됐거나 오래됐으면(또는 DB 저장본보다 오래됐으면) null 을 돌려주고 해당 값은 지운다 */
export function loadModeDraft(templateId: string, kind: ModeDraftKind, opts: { notBefore?: number; now?: number } = {}): ModeDraft | null {
  const key = keyOf(kind, templateId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const now = opts.now ?? Date.now()
    if (!isValidDraft(parsed, kind) || now - parsed.savedAt > MODE_DRAFT_MAX_AGE_MS || parsed.savedAt <= (opts.notBefore ?? 0)) {
      localStorage.removeItem(key)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearModeDraft(templateId: string, kind: ModeDraftKind): void {
  try {
    localStorage.removeItem(keyOf(kind, templateId))
  } catch {
    /* 저장소 접근 불가 — 지울 것도 없다 */
  }
}
