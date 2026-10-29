// productManuals.ts — 상품설명서(PDF) 공통 규칙 (CMS 등록·상품목록 패널·고객 상품상세·서버 검증 공용)
// 저장 위치: products.manual_files(jsonb 배열) — 파일 자체는 공개 버킷 product-manuals 에 {상품id|temp/등록임시id}/{uuid}.pdf 로 둔다.
// 이 파일은 브라우저·서버 양쪽에서 쓰이므로 $env 를 import 하지 않는다(공개 주소의 기준 주소는 호출부가 넘긴다).
import type { MediaViewerItem } from '$lib/types/media-viewer'

export const PRODUCT_MANUAL_BUCKET = 'product-manuals'
export const MAX_PRODUCT_MANUALS = 10
export const MAX_PRODUCT_MANUAL_BYTES = 10 * 1024 * 1024 // 프로젝트 업로드 표준 10MB (front-uiux §15-1a)
export const MAX_PRODUCT_MANUAL_BYTES_LABEL = '10MB'
export const MAX_MANUAL_NAME_LENGTH = 120

export interface ProductManualFile {
  /** 버킷 안 경로 — {상품id}/{uuid}.pdf 또는 temp/{등록임시id}/{uuid}.pdf */
  path: string
  /** 화면에 보이는 원본 파일 이름 */
  name: string
  /** 바이트 */
  size: number
  /** 올린 시각(ISO) */
  uploaded_at: string
}

export type ManualCheck = { ok: true } | { ok: false; error: string }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PATH_RE = new RegExp(`^(?:${UUID}|temp/[A-Za-z0-9_-]{6,64})/${UUID}\\.pdf$`)

/** 올리기 전 검사 — 클라이언트(안내)·서명 발급 서버(최종) 공용 */
export function validateManualUpload(contentType: string, size: number): ManualCheck {
  if (contentType !== 'application/pdf') return { ok: false, error: 'PDF 파일만 올릴 수 있어요.' }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: '비어 있는 파일은 올릴 수 없어요.' }
  if (size > MAX_PRODUCT_MANUAL_BYTES) {
    return { ok: false, error: `파일 크기는 ${MAX_PRODUCT_MANUAL_BYTES_LABEL} 이하여야 해요.` }
  }
  return { ok: true }
}

/** scope = 상품 id 또는 'temp/등록임시id' */
export function buildManualPath(scope: string): string {
  return `${scope}/${crypto.randomUUID()}.pdf`
}

export function isValidManualPath(path: unknown): path is string {
  return typeof path === 'string' && PATH_RE.test(path)
}

// 파일명에서 지울 보이지 않는 제어문자 — 줄바꿈·탭 등 제어 코드, 방향 전환(RTL 위장: U+202A~202E·2066~2069·200E/200F), 제로폭·BOM(200B~200D·2060·FEFF)
// eslint-disable-next-line no-control-regex
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g

/** 화면에 보이는 파일 이름 정리 — 보이지 않는 제어문자를 지우고 앞뒤 공백을 다듬는다(모양 위장 방지) */
export function sanitizeManualName(raw: string): string {
  return raw.replace(INVISIBLE_RE, '').trim()
}

function toManualFile(v: unknown): ProductManualFile | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!isValidManualPath(o.path)) return null
  const name = typeof o.name === 'string' ? sanitizeManualName(o.name) : ''
  if (!name) return null
  const size = typeof o.size === 'number' && Number.isFinite(o.size) ? o.size : 0
  const uploaded_at = typeof o.uploaded_at === 'string' && o.uploaded_at ? o.uploaded_at : ''
  return { path: o.path, name: name.slice(0, MAX_MANUAL_NAME_LENGTH), size, uploaded_at }
}

/** 저장값 읽기 — 잘못된 항목은 조용히 버린다(화면이 깨지지 않게) */
export function normalizeManualFiles(raw: unknown): ProductManualFile[] {
  if (!Array.isArray(raw)) return []
  const out: ProductManualFile[] = []
  for (const v of raw) {
    const f = toManualFile(v)
    if (f) out.push(f)
  }
  return out
}

export interface ManualParseContext {
  /** 저장 대상 상품 id (상품 등록처럼 아직 없으면 null) */
  productId: string | null
  /** 지금 DB에 저장돼 있는 목록(이미 있던 temp/ 경로를 계속 허용하기 위함) */
  existing: ProductManualFile[]
}

export type ManualParseResult = { ok: true; files: ProductManualFile[] } | { ok: false; error: string }

/** 저장 입력 검증 — 서버가 폼 값(JSON 문자열)을 받을 때 사용. 형식·개수·크기·경로 소유를 모두 확인한다. */
export function parseManualFilesInput(str: string | null | undefined, ctx: ManualParseContext): ManualParseResult {
  if (!str || !str.trim()) return { ok: true, files: [] }
  let raw: unknown
  try {
    raw = JSON.parse(str)
  } catch {
    return { ok: false, error: '상품설명서 정보를 읽을 수 없어요.' }
  }
  if (!Array.isArray(raw)) return { ok: false, error: '상품설명서 정보 형식이 올바르지 않아요.' }
  if (raw.length > MAX_PRODUCT_MANUALS) {
    return { ok: false, error: `상품설명서는 최대 ${MAX_PRODUCT_MANUALS}개까지 등록할 수 있어요.` }
  }
  const existingPaths = new Set(ctx.existing.map((f) => f.path))
  const seen = new Set<string>()
  const files: ProductManualFile[] = []
  for (const v of raw) {
    const f = toManualFile(v)
    if (!f) return { ok: false, error: '상품설명서 정보가 올바르지 않아요.' }
    if (seen.has(f.path)) return { ok: false, error: '같은 파일이 중복으로 들어 있어요.' }
    seen.add(f.path)
    const owned = existingPaths.has(f.path)
      || (ctx.productId ? f.path.startsWith(`${ctx.productId}/`) : f.path.startsWith('temp/'))
    if (!owned) return { ok: false, error: '허용되지 않은 파일 경로예요.' }
    if (!Number.isInteger(f.size) || f.size <= 0 || f.size > MAX_PRODUCT_MANUAL_BYTES) {
      return { ok: false, error: `파일 크기는 ${MAX_PRODUCT_MANUAL_BYTES_LABEL} 이하여야 해요.` }
    }
    files.push({ ...f, uploaded_at: f.uploaded_at || new Date().toISOString() })
  }
  return { ok: true, files }
}

/** 저장으로 목록에서 빠진 파일 경로(저장소에서 지울 대상) */
export function removedManualPaths(before: ProductManualFile[], after: ProductManualFile[]): string[] {
  const keep = new Set(after.map((f) => f.path))
  return before.filter((f) => !keep.has(f.path)).map((f) => f.path)
}

export function manualPublicUrl(path: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${PRODUCT_MANUAL_BUCKET}/${path}`
}

export function manualsToViewerItems(files: ProductManualFile[], baseUrl: string): MediaViewerItem[] {
  return files.map((f) => ({ url: manualPublicUrl(f.path, baseUrl), name: f.name, type: 'pdf' as const }))
}

export function formatManualSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}
