/**
 * pdfFingerprint.ts — PDF 쪽별 텍스트 지문 지도(변경 위치 분석용)
 *
 * 보관 시점에 PDF의 각 쪽 텍스트를 뽑아 "쪽 해시 + 줄 해시"만 저장한다(본문 텍스트·개인정보는 저장하지 않는다).
 * 나중에 제출된 파일에서 같은 방식으로 지도를 만들어 대조하면 "몇 쪽이 바뀌었는지, 제출 파일의 어느 줄이 기록에 없는지"를 알 수 있다.
 *
 * ⚠️ 이 결과는 "진본 판정"이 아니라 참고 분석이다. 진본 판정은 파일 지문(SHA-256) 대조와 서명 봉인으로만 한다.
 *   텍스트 추출은 도구마다 조금 다를 수 있어 오탐이 있을 수 있고, 이미지(서명·직인 그림)만 바뀐 경우는 잡지 못한다.
 * 변경 위치는 관리자 전용이다 — 고객·공개 화면에는 지도 대조 결과를 보여주지 않는다.
 */
import { sha256Hex } from '$lib/contract-signature/signatureEvidence'

export const PAGE_MAP_VERSION = 1
const LINE_HASH_LENGTH = 12
const MAX_PAGES = 200
const MAX_LINES_PER_PAGE = 400

export interface PageFingerprint {
  /** 1부터 시작하는 쪽 번호 */
  n: number
  /** 공백을 모두 제거한 쪽 전체 텍스트의 SHA-256 — 줄바꿈·공백 차이에 흔들리지 않는 쪽 단위 비교용 */
  compactSha: string
  /** 공백 제거한 각 줄의 SHA-256 앞 12자 — 변경된 줄 찾기용 */
  lines: string[]
  /** 공백 제외 글자 수(참고) */
  chars: number
}

export interface PageMap {
  v: typeof PAGE_MAP_VERSION
  pages: PageFingerprint[]
}

export interface PageText {
  /** 줄 단위 텍스트(원문) */
  lines: string[]
}

/** 비교용 정규화: 유니코드 호환 정규화(NFKC) 후 모든 공백 제거 */
export function compactText(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '')
}

/** 객체 키를 정렬해 직렬화 — jsonb는 키 순서를 보존하지 않으므로 해시는 항상 이 형태로 계산한다 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function pageMapSha256(map: PageMap): Promise<string> {
  return sha256Hex(canonicalJson(map))
}

export async function buildPageMap(pages: PageText[]): Promise<PageMap> {
  const out: PageFingerprint[] = []
  for (let i = 0; i < Math.min(pages.length, MAX_PAGES); i++) {
    const compactLines = pages[i].lines.map(compactText).filter((l) => l.length > 0).slice(0, MAX_LINES_PER_PAGE)
    const lineHashes: string[] = []
    for (const l of compactLines) lineHashes.push((await sha256Hex(l)).slice(0, LINE_HASH_LENGTH))
    const joined = compactLines.join('')
    out.push({ n: i + 1, compactSha: await sha256Hex(joined), lines: lineHashes, chars: joined.length })
  }
  return { v: PAGE_MAP_VERSION, pages: out }
}

/** DB(jsonb)에서 읽은 값이 올바른 지도 형태인지 확인 */
export function parsePageMap(raw: unknown): PageMap | null {
  const o = raw as { v?: unknown; pages?: unknown } | null
  if (!o || o.v !== PAGE_MAP_VERSION || !Array.isArray(o.pages)) return null
  const pages: PageFingerprint[] = []
  for (const p of o.pages) {
    const q = p as { n?: unknown; compactSha?: unknown; lines?: unknown; chars?: unknown }
    if (typeof q.n !== 'number' || typeof q.compactSha !== 'string' || !Array.isArray(q.lines) || typeof q.chars !== 'number') return null
    if (!q.lines.every((l) => typeof l === 'string')) return null
    pages.push({ n: q.n, compactSha: q.compactSha, lines: q.lines as string[], chars: q.chars })
  }
  return { v: PAGE_MAP_VERSION, pages }
}

/**
 * PDF 바이트에서 쪽별 텍스트 줄을 뽑는다(pdfjs-dist 서버용 빌드). 암호화·손상·텍스트 없는 스캔 PDF는 빈 줄 목록 또는 예외.
 * 호출부는 예외를 잡아 "추출 실패"로 처리한다(진본 판정에는 영향 없음).
 */
export async function extractPageTexts(bytes: Uint8Array): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // 서버(Node)에서 pdf.js는 "가짜 워커"를 `import(workerSrc)`로 동적으로 불러오는데, 경로가 변수라 Vercel 번들 추적(nft)이 pdf.worker.mjs를 함수에 넣지 못한다
  // → 배포 환경에서만 getDocument가 실패해 쪽별 지도가 빈 값으로 봉인되던 결함(2026-10-08 Production 실측, 로컬은 node_modules가 있어 통과).
  // 리터럴 경로로 직접 불러(번들에 포함) globalThis.pdfjsWorker에 등록하면 pdf.js가 동적 import 없이 그 핸들러를 쓴다(pdf.js 공식 번들러 안내 방식).
  const g = globalThis as unknown as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }
  if (!g.pdfjsWorker?.WorkerMessageHandler) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  // pdf.js는 넘긴 버퍼를 소유권 이전(detach)하므로 복사본을 넘긴다
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise
  try {
    const pages: PageText[] = []
    const total = Math.min(doc.numPages, MAX_PAGES)
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const lines: string[] = []
      let current = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        current += item.str
        if (item.hasEOL) { lines.push(current); current = '' }
      }
      if (current) lines.push(current)
      pages.push({ lines })
      page.cleanup()
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

export type PageDiffStatus = 'same' | 'changed' | 'added' | 'missing'

export interface PageDiff {
  page: number
  status: PageDiffStatus
  /** 제출 파일에서 기록에 없는 줄(원문, 최대 8줄·줄당 80자) — 관리자 전용 */
  changedLines: string[]
  /** 기록에는 있는데 제출 파일에서 사라진 줄 수 */
  missingLineCount: number
}

export interface PageMapComparison {
  recordedPages: number
  submittedPages: number
  /** 모든 쪽의 텍스트가 같다 → 파일 지문만 다르다면 "내용은 같고 파일만 다시 저장됨"일 가능성이 높다 */
  textIdentical: boolean
  pages: PageDiff[]
}

const MAX_CHANGED_LINES = 8
const MAX_LINE_CHARS = 80

/** 기록된 지도와 제출 파일(지도 + 원문 줄)을 쪽 번호 기준으로 대조한다. */
export async function comparePageMaps(recorded: PageMap, submitted: PageMap, submittedTexts: PageText[]): Promise<PageMapComparison> {
  const pages: PageDiff[] = []
  const total = Math.max(recorded.pages.length, submitted.pages.length)
  for (let i = 0; i < total; i++) {
    const a = recorded.pages[i]
    const b = submitted.pages[i]
    if (!a) { pages.push({ page: i + 1, status: 'added', changedLines: [], missingLineCount: 0 }); continue }
    if (!b) { pages.push({ page: i + 1, status: 'missing', changedLines: [], missingLineCount: a.lines.length }); continue }
    if (a.compactSha === b.compactSha) { pages.push({ page: i + 1, status: 'same', changedLines: [], missingLineCount: 0 }); continue }
    const recordedSet = new Set(a.lines)
    const submittedSet = new Set(b.lines)
    const changed: string[] = []
    const texts = (submittedTexts[i]?.lines ?? []).map(compactText).map((c, idx) => ({ c, raw: (submittedTexts[i]?.lines ?? [])[idx].trim() })).filter((x) => x.c.length > 0)
    for (const t of texts) {
      if (changed.length >= MAX_CHANGED_LINES) break
      const h = (await sha256Hex(t.c)).slice(0, LINE_HASH_LENGTH)
      if (!recordedSet.has(h)) changed.push(t.raw.length > MAX_LINE_CHARS ? `${t.raw.slice(0, MAX_LINE_CHARS)}…` : t.raw)
    }
    const missingLineCount = a.lines.filter((h) => !submittedSet.has(h)).length
    pages.push({ page: i + 1, status: 'changed', changedLines: changed, missingLineCount })
  }
  return {
    recordedPages: recorded.pages.length,
    submittedPages: submitted.pages.length,
    textIdentical: pages.every((p) => p.status === 'same'),
    pages,
  }
}
