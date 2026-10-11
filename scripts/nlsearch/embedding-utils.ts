// embedding-utils.ts — D-1 외부 임베딩 비교용 순수 보조 함수 (네트워크·환경변수 없음, 단위 테스트 대상)

export interface EmbedConfig {
  baseUrl: string
  model: string
  apiKey: string
}

/** OpenAI 호환 /embeddings 요청 본문. 입력은 비어 있지 않은 문자열만 허용하고 길이를 제한한다. */
export function buildEmbeddingRequest(model: string, inputs: readonly string[], maxChars = 4000): { model: string; input: string[] } {
  const input = inputs.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, maxChars))
  if (input.some((t) => t.length === 0)) throw new Error('빈 입력은 임베딩할 수 없습니다')
  return { model, input }
}

/** 응답(data[].index·embedding)을 입력 순서대로 복원. 개수·차원이 어긋나면 예외. */
export function parseEmbeddingResponse(body: unknown, expected: number): Float32Array[] {
  const data = (body as { data?: { index?: number; embedding?: number[] }[] } | null)?.data
  if (!Array.isArray(data) || data.length !== expected) throw new Error(`임베딩 응답 개수 불일치(기대 ${expected})`)
  const out: Float32Array[] = new Array(expected)
  for (const row of data) {
    if (typeof row.index !== 'number' || row.index < 0 || row.index >= expected || !Array.isArray(row.embedding) || row.embedding.length === 0)
      throw new Error('임베딩 응답 형식 오류')
    out[row.index] = l2(Float32Array.from(row.embedding))
  }
  if (out.some((v) => !v)) throw new Error('임베딩 응답 누락')
  const dim = out[0].length
  if (out.some((v) => v.length !== dim)) throw new Error('임베딩 차원 불일치')
  return out
}

export function l2(v: Float32Array): Float32Array {
  let s = 0
  for (const x of v) s += x * x
  if (s === 0) return v
  const inv = 1 / Math.sqrt(s)
  return v.map((x) => x * inv)
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * 외부 임베딩의 코사인은 모델마다 기준선이 달라(무관한 문서도 0.2~0.4) 고정 기준값을 쓸 수 없다.
 * 질의별로 "평균 + zCut×표준편차" 이상인 문서만 남기고 0~1로 늘려(최댓값=1) 내부 의미 점수(semanticRank)와 같은 척도로 만든다.
 */
export function normalizeSims(cosines: ReadonlyMap<string, number>, zCut = 1.0): Map<string, number> {
  const vals = [...cosines.values()]
  const out = new Map<string, number>()
  if (vals.length < 3) return out
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
  if (sd === 0) return out
  const cut = mean + zCut * sd
  const max = Math.max(...vals)
  if (max <= cut) return out
  for (const [id, c] of cosines) if (c >= cut) out.set(id, 0.3 + 0.7 * ((c - cut) / (max - cut))) // 기준 통과분은 0.3~1.0
  return out
}

/** 두 유사도 맵을 항목별 평균(없는 쪽은 0)으로 합친다 */
export function averageSims(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of new Set([...a.keys(), ...b.keys()])) out.set(id, ((a.get(id) ?? 0) + (b.get(id) ?? 0)) / 2)
  return out
}

/** 키 없이 파이프라인을 점검하는 결정적 가짜 임베딩(단어 해시 → 64차원). 품질 비교에는 쓰지 않는다. */
export function fakeEmbed(text: string, dim = 64): Float32Array {
  const v = new Float32Array(dim)
  for (const w of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    let h = 2166136261
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619)
    v[(h >>> 0) % dim] += 1
  }
  return l2(v)
}
