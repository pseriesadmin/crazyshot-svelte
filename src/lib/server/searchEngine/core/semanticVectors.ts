/**
 * core/semanticVectors.ts — 자체 마이크로 엔진 v0: 공출현 통계 기반 소형 의미 벡터 (B-1)
 *
 * ⚠️ 이 파일은 crazyshot 전용 의존성(Supabase, $env, SvelteKit 타입 등)을 절대 포함하지 않는다. 의존성: core 안의 koreanTokenizer만.
 *
 * 원리: ① 말뭉치에서 단어(와 한글 음절 2-gram)가 같은 창(window) 안에 함께 나온 횟수를 센다 → ② PPMI(양의 점별 상호정보량)로
 * "우연보다 자주 같이 나온 정도"를 만든다 → ③ 단어마다 PPMI 행을 결정적 랜덤 투영(고정 seed)으로 dim 차원으로 줄이고 L2 정규화한다.
 * 같은 맥락에서 쓰인 말(셀카봉≈셀피스틱)은 벡터가 가까워진다. 신경망 학습이 아니라 통계 + 선형 투영이라 데이터가 작아도 되고,
 * 같은 입력이면 항상 같은 결과(바이트 단위)다. 외부 API·네트워크 없음.
 *
 * 한계: 말뭉치에 없는 말은 영벡터(의미 점수 0 → 호출 측이 글자 일치 결과만 쓴다). 작은 말뭉치에서 드문 말의 벡터는 부정확하므로
 * minCount·IDF 가중을 둔다. 효과가 평가에서 확인되기 전에는 호출 측 가중치(semantic_weight)를 0으로 둔다.
 */

import { koreanProcessTerm, koreanTokenize } from './koreanTokenizer'

export interface CorpusDoc {
  text: string
  /** 이 문서의 공출현에 곱하는 가중(동의어 묶음처럼 강한 신호는 >1). 기본 1 */
  weight?: number
}

export interface BuildOptions {
  /** 벡터 차원 (기본 64) */
  dim?: number
  /** 랜덤 투영 seed (기본 20261010) */
  seed?: number
  /** 어휘 최소 등장 횟수 (기본 2) */
  minCount?: number
  /** 어휘 최대 크기 — 빈도 높은 순으로 자른다 (기본 20000) */
  maxVocab?: number
  /** 공출현 창 크기(토큰 거리, 기본 8) */
  window?: number
}

export interface SemanticModel {
  dim: number
  seed: number
  vocab: string[]
  index: Map<string, number>
  idf: Float32Array
  /** vocab.length × dim, 행마다 L2 정규화 */
  vectors: Float32Array
}

const DEFAULTS = { dim: 64, seed: 20261010, minCount: 2, maxVocab: 20000, window: 8 }
const MAGIC = 'NLSV1\0'
const CDS_ALPHA = 0.75 // 맥락 분포 평활(희귀 맥락 편향 완화)

const isHangul = (t: string): boolean => /^[가-힣]+$/.test(t)

/** 소문자·조사 제거 낱말 + (3자 이상 한글 낱말은) 음절 2-gram 토큰('~' 접두) */
export function tokenizeForSemantics(text: string): string[] {
  const out: string[] = []
  for (const raw of koreanTokenize(text)) {
    const t = koreanProcessTerm(raw)
    if (!t || t.length < 2) continue
    out.push(t)
    if (isHangul(t) && t.length >= 3) for (let i = 0; i + 2 <= t.length; i++) out.push(`~${t.slice(i, i + 2)}`)
  }
  return out
}

// ── 결정적 난수 ──────────────────────────────────────────────────────────────

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 맥락 토큰의 고정 랜덤 벡터(±1) — 같은 (seed, 토큰)이면 항상 같다 */
function randomVector(token: string, seed: number, dim: number): Float32Array {
  const rnd = mulberry32(fnv1a(token) ^ Math.imul(seed >>> 0, 0x9e3779b1))
  const v = new Float32Array(dim)
  for (let i = 0; i < dim; i++) v[i] = rnd() < 0.5 ? -1 : 1
  return v
}

function l2normalize(v: Float32Array): Float32Array {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  if (s === 0) return v
  const inv = 1 / Math.sqrt(s)
  for (let i = 0; i < v.length; i++) v[i] *= inv
  return v
}

// ── 학습(통계) ───────────────────────────────────────────────────────────────

export function buildSemanticModel(docs: readonly CorpusDoc[], options: BuildOptions = {}): SemanticModel {
  const o = { ...DEFAULTS, ...options }
  const tokenized = docs.map((d) => ({ tokens: tokenizeForSemantics(d.text), weight: d.weight ?? 1 }))

  // 어휘: 빈도(가중 없이 단순 등장 횟수) ≥ minCount, 빈도순·사전순으로 결정적 정렬 후 maxVocab 상한
  const freq = new Map<string, number>()
  const df = new Map<string, number>()
  for (const d of tokenized) {
    for (const t of d.tokens) freq.set(t, (freq.get(t) ?? 0) + 1)
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const vocab = [...freq.entries()]
    .filter(([, n]) => n >= o.minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, o.maxVocab)
    .map(([t]) => t)
  const index = new Map(vocab.map((t, i) => [t, i]))
  const V = vocab.length

  // 공출현: 창 안의 서로 다른 위치 쌍(대칭), 거리 가중 1/d
  const pair: Map<number, number>[] = Array.from({ length: V }, () => new Map())
  const rowSum = new Float64Array(V)
  let total = 0
  for (const d of tokenized) {
    const ids = d.tokens.map((t) => index.get(t) ?? -1)
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] < 0) continue
      for (let j = i + 1; j < ids.length && j - i <= o.window; j++) {
        if (ids[j] < 0 || ids[j] === ids[i]) continue
        const w = d.weight / (j - i)
        pair[ids[i]].set(ids[j], (pair[ids[i]].get(ids[j]) ?? 0) + w)
        pair[ids[j]].set(ids[i], (pair[ids[j]].get(ids[i]) ?? 0) + w)
        rowSum[ids[i]] += w
        rowSum[ids[j]] += w
        total += 2 * w
      }
    }
  }

  // PPMI → 랜덤 투영
  const colPow = new Float64Array(V)
  let colPowSum = 0
  for (let c = 0; c < V; c++) {
    colPow[c] = rowSum[c] ** CDS_ALPHA
    colPowSum += colPow[c]
  }
  const rcache = new Map<number, Float32Array>()
  const rvec = (c: number): Float32Array => {
    let r = rcache.get(c)
    if (!r) {
      r = randomVector(vocab[c], o.seed, o.dim)
      rcache.set(c, r)
    }
    return r
  }
  const vectors = new Float32Array(V * o.dim)
  const row = new Float32Array(o.dim)
  for (let w = 0; w < V; w++) {
    row.fill(0)
    const entries = [...pair[w].entries()].sort((a, b) => a[0] - b[0]) // 합산 순서 고정(부동소수 결정성)
    for (const [c, cnt] of entries) {
      const pmi = Math.log((cnt / total) / ((rowSum[w] / total) * (colPow[c] / colPowSum)))
      if (!(pmi > 0)) continue
      const r = rvec(c)
      for (let k = 0; k < o.dim; k++) row[k] += pmi * r[k]
    }
    vectors.set(l2normalize(row.slice()), w * o.dim)
  }

  const D = docs.length
  const idf = new Float32Array(V)
  for (let i = 0; i < V; i++) idf[i] = Math.log((D + 1) / ((df.get(vocab[i]) ?? 0) + 1)) + 1

  return { dim: o.dim, seed: o.seed, vocab, index, idf, vectors }
}

// ── 질의·문서 임베딩 ─────────────────────────────────────────────────────────

/** 텍스트를 IDF 가중 평균 벡터(L2 정규화)로 바꾼다. 아는 말이 하나도 없으면 영벡터. */
export function embedText(model: SemanticModel, text: string): Float32Array {
  const out = new Float32Array(model.dim)
  for (const t of tokenizeForSemantics(text)) {
    const i = model.index.get(t)
    if (i === undefined) continue
    const w = model.idf[i]
    const base = i * model.dim
    for (let k = 0; k < model.dim; k++) out[k] += w * model.vectors[base + k]
  }
  return l2normalize(out)
}

/** 코사인 유사도 (둘 다 L2 정규화 가정 — 영벡터면 0) */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// ── 직렬화 ───────────────────────────────────────────────────────────────────
// [MAGIC 6B][헤더길이 u32 LE][헤더 JSON(utf8, 4바이트 정렬용 공백 패딩)][idf f32 × V][vectors f32 × V·dim]

export function serializeSemanticModel(m: SemanticModel): Uint8Array {
  const header = JSON.stringify({ dim: m.dim, seed: m.seed, vocab: m.vocab })
  const headerBytes = new TextEncoder().encode(header)
  const pad = (4 - ((MAGIC.length + 4 + headerBytes.length) % 4)) % 4
  const headerLen = headerBytes.length + pad
  const V = m.vocab.length
  const total = MAGIC.length + 4 + headerLen + V * 4 + V * m.dim * 4
  const buf = new ArrayBuffer(total)
  const u8 = new Uint8Array(buf)
  for (let i = 0; i < MAGIC.length; i++) u8[i] = MAGIC.charCodeAt(i)
  new DataView(buf).setUint32(MAGIC.length, headerLen, true)
  u8.set(headerBytes, MAGIC.length + 4)
  u8.fill(0x20, MAGIC.length + 4 + headerBytes.length, MAGIC.length + 4 + headerLen)
  const off = MAGIC.length + 4 + headerLen
  new Float32Array(buf, off, V).set(m.idf)
  new Float32Array(buf, off + V * 4, V * m.dim).set(m.vectors)
  return u8
}

export function deserializeSemanticModel(bytes: Uint8Array): SemanticModel {
  const fail = (why: string): never => {
    throw new Error(`의미 벡터 모델을 읽을 수 없습니다: ${why}`)
  }
  if (bytes.length < MAGIC.length + 4) return fail('파일이 너무 짧음')
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return fail('형식 표지 불일치')
  const copy = new Uint8Array(bytes).buffer // 정렬·소유권을 보장하는 사본
  const headerLen = new DataView(copy).getUint32(MAGIC.length, true)
  const hStart = MAGIC.length + 4
  if ((hStart + headerLen) % 4 !== 0 || hStart + headerLen > copy.byteLength) return fail('헤더 길이 오류')
  let header: { dim: unknown; seed: unknown; vocab: unknown }
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(copy, hStart, headerLen))) as typeof header
  } catch {
    return fail('헤더 해석 실패')
  }
  const { dim, seed, vocab } = header
  if (!Number.isInteger(dim) || (dim as number) <= 0 || !Number.isInteger(seed) || !Array.isArray(vocab) || !vocab.every((t) => typeof t === 'string'))
    return fail('헤더 값 오류')
  const d = dim as number
  const V = vocab.length
  const off = hStart + headerLen
  if (copy.byteLength !== off + V * 4 + V * d * 4) return fail('본문 길이 불일치')
  const idf = new Float32Array(copy.slice(off, off + V * 4))
  const vectors = new Float32Array(copy.slice(off + V * 4))
  return { dim: d, seed: seed as number, vocab: vocab as string[], index: new Map((vocab as string[]).map((t, i) => [t, i])), idf, vectors }
}
