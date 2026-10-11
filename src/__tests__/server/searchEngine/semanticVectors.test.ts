/**
 * semanticVectors.test.ts — B-1 마이크로 엔진(공출현 통계 → PPMI → 결정적 랜덤 투영) 순수 코어 계약
 * ① 같은 입력 = 같은 결과(바이트 단위) ② 같은 맥락에서 쓰이는 말은 가깝다 ③ 모르는 말·빈 입력은 0 ④ 직렬화 왕복
 */
import { describe, it, expect } from 'vitest'
import {
  buildSemanticModel,
  cosine,
  deserializeSemanticModel,
  embedText,
  serializeSemanticModel,
  tokenizeForSemantics,
  type CorpusDoc,
} from '$lib/server/searchEngine/core/semanticVectors'

const corpus: CorpusDoc[] = [
  { text: '셀카봉 연장 촬영 휴대폰 손잡이' },
  { text: '셀피스틱 연장 촬영 휴대폰 손잡이' },
  { text: '셀카봉 블루투스 리모컨 촬영 휴대폰' },
  { text: '셀피스틱 블루투스 리모컨 촬영 휴대폰' },
  { text: '삼각대 고정 무게 안정 지지 다리' },
  { text: '삼각대 높이 조절 무게 안정 다리' },
  { text: '렌즈 초점 거리 조리개 화각' },
  { text: '렌즈 망원 화각 초점 조리개' },
]
const opts = { dim: 32, seed: 7, minCount: 1, window: 8 }

describe('tokenizeForSemantics', () => {
  it('조사를 떼고 소문자로 만들며 3자 이상 한글 낱말에서 음절 2-gram 토큰(~접두)을 더한다', () => {
    const t = tokenizeForSemantics('셀카봉을 Sony A7S3')
    expect(t).toContain('셀카봉')
    expect(t).toContain('sony')
    expect(t).toContain('a7s3')
    expect(t).toContain('~셀카')
    expect(t).toContain('~카봉')
  })
  it('빈 입력은 빈 배열', () => {
    expect(tokenizeForSemantics('')).toEqual([])
    expect(tokenizeForSemantics('  ,, ')).toEqual([])
  })
})

describe('buildSemanticModel', () => {
  it('같은 입력이면 직렬화 바이트가 완전히 같다(결정적)', () => {
    const a = serializeSemanticModel(buildSemanticModel(corpus, opts))
    const b = serializeSemanticModel(buildSemanticModel([...corpus], opts))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('다른 seed면 결과가 달라진다', () => {
    const a = serializeSemanticModel(buildSemanticModel(corpus, opts))
    const b = serializeSemanticModel(buildSemanticModel(corpus, { ...opts, seed: 8 }))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('같은 맥락에서 쓰인 동의어(셀카봉≈셀피스틱)가 무관한 말(삼각대)보다 가깝다', () => {
    const m = buildSemanticModel(corpus, opts)
    const sel = embedText(m, '셀카봉')
    expect(cosine(sel, embedText(m, '셀피스틱'))).toBeGreaterThan(cosine(sel, embedText(m, '삼각대')) + 0.1)
  })

  it('벡터는 L2 정규화되어 있다(자기 자신과의 코사인 = 1)', () => {
    const m = buildSemanticModel(corpus, opts)
    expect(cosine(embedText(m, '렌즈'), embedText(m, '렌즈'))).toBeCloseTo(1, 5)
  })

  it('말뭉치에 없는 말·빈 입력은 영벡터(코사인 0)', () => {
    const m = buildSemanticModel(corpus, opts)
    const zero = embedText(m, '블랙매직')
    expect(zero.every((x) => x === 0)).toBe(true)
    expect(cosine(zero, embedText(m, '렌즈'))).toBe(0)
    expect(cosine(embedText(m, ''), embedText(m, ''))).toBe(0)
  })

  it('minCount 미만 빈도의 말은 어휘에서 빠진다', () => {
    const m = buildSemanticModel(corpus, { ...opts, minCount: 3 })
    expect(embedText(m, '삼각대').every((x) => x === 0)).toBe(true) // 2회 등장
    expect(embedText(m, '촬영').some((x) => x !== 0)).toBe(true) // 4회 등장
  })

  it('maxVocab 상한을 지킨다', () => {
    const m = buildSemanticModel(corpus, { ...opts, maxVocab: 5 })
    expect(m.vocab.length).toBeLessThanOrEqual(5)
  })
})

describe('직렬화', () => {
  it('왕복 후 같은 입력이 같은 벡터를 만든다', () => {
    const m = buildSemanticModel(corpus, opts)
    const back = deserializeSemanticModel(serializeSemanticModel(m))
    expect(back.dim).toBe(m.dim)
    expect(back.vocab).toEqual(m.vocab)
    expect(Array.from(embedText(back, '셀카봉 연장'))).toEqual(Array.from(embedText(m, '셀카봉 연장')))
  })

  it('손상된 바이트는 예외(호출 측이 의미 점수를 끈다)', () => {
    const bytes = serializeSemanticModel(buildSemanticModel(corpus, opts))
    expect(() => deserializeSemanticModel(bytes.slice(0, 20))).toThrow()
    const bad = bytes.slice()
    bad[0] = 0
    expect(() => deserializeSemanticModel(bad)).toThrow()
  })
})
