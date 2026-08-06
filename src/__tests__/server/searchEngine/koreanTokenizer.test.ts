import { describe, it, expect } from 'vitest'
import {
  stripTrailingParticle,
  extractChosung,
  toChosung,
  isChosungQuery,
  koreanTokenize,
  koreanProcessTerm,
} from '$lib/server/searchEngine/core/koreanTokenizer'

/**
 * koreanTokenizer.test.ts — 조사 제거 · 초성 변환 유닛 테스트
 * core/ 계층의 독립성 확인: crazyshot 전용 import 없이 순수 로직만 검증
 */

describe('stripTrailingParticle — 조사 제거', () => {
  it('단순 조사 제거: "카메라를" → "카메라"', () => {
    expect(stripTrailingParticle('카메라를')).toBe('카메라')
  })

  it('"카메라는" → "카메라"', () => {
    expect(stripTrailingParticle('카메라는')).toBe('카메라')
  })

  it('"카메라가" → "카메라"', () => {
    expect(stripTrailingParticle('카메라가')).toBe('카메라')
  })

  it('"으로부터" (복합 조사) → 전체 제거, 빈 문자열 방지', () => {
    // "집으로부터" → "집"
    expect(stripTrailingParticle('집으로부터')).toBe('집')
  })

  it('조사가 없으면 원본 반환', () => {
    expect(stripTrailingParticle('카메라')).toBe('카메라')
  })

  it('1글자 토큰은 조사가 붙어도 제거 안 함 (길이 보호)', () => {
    // 길이 보호: token.length > p.length 조건
    expect(stripTrailingParticle('는')).toBe('는')
    expect(stripTrailingParticle('가')).toBe('가')
  })

  it('영문은 조사 제거 없이 원본 반환', () => {
    expect(stripTrailingParticle('camera')).toBe('camera')
  })
})

describe('extractChosung — 한글 초성 추출', () => {
  it('"소" → "ㅅ"', () => {
    expect(extractChosung('소')).toBe('ㅅ')
  })

  it('"니" → "ㄴ"', () => {
    expect(extractChosung('니')).toBe('ㄴ')
  })

  it('한글이 아닌 문자는 그대로', () => {
    expect(extractChosung('A')).toBe('A')
    expect(extractChosung('1')).toBe('1')
  })
})

describe('toChosung — 문자열 초성 변환', () => {
  it('"소니" → "ㅅㄴ"', () => {
    expect(toChosung('소니')).toBe('ㅅㄴ')
  })

  it('"카메라" → "ㅋㅁㄹ"', () => {
    expect(toChosung('카메라')).toBe('ㅋㅁㄹ')
  })

  it('공백 포함 — "소니 카메라" → "ㅅㄴ ㅋㅁㄹ"', () => {
    expect(toChosung('소니 카메라')).toBe('ㅅㄴ ㅋㅁㄹ')
  })

  it('영문·숫자는 소문자 변환만', () => {
    expect(toChosung('Sony A7IV')).toBe('sony a7iv')
  })
})

describe('isChosungQuery — 초성 질의 판별', () => {
  it('"ㅅㄴ" → true (초성 전용)', () => {
    expect(isChosungQuery('ㅅㄴ')).toBe(true)
  })

  it('"소니" → false (완성 한글)', () => {
    expect(isChosungQuery('소니')).toBe(false)
  })

  it('"camera" → false (영문)', () => {
    expect(isChosungQuery('camera')).toBe(false)
  })
})

describe('koreanTokenize — MiniSearch tokenize 훅', () => {
  it('공백 기준 분리', () => {
    const tokens = koreanTokenize('소니 카메라')
    expect(tokens).toContain('소니')
    expect(tokens).toContain('카메라')
  })

  it('구두점 기준 분리', () => {
    const tokens = koreanTokenize('카메라, 렌즈! 빌리기')
    expect(tokens).toContain('카메라')
    expect(tokens).toContain('렌즈')
    expect(tokens).toContain('빌리기')
  })

  it('빈 토큰 제거', () => {
    const tokens = koreanTokenize('  소니   카메라  ')
    expect(tokens).not.toContain('')
    expect(tokens).toEqual(expect.arrayContaining(['소니', '카메라']))
  })
})

describe('koreanProcessTerm — MiniSearch processTerm 훅', () => {
  it('소문자 변환', () => {
    expect(koreanProcessTerm('CAMERA')).toBe('camera')
  })

  it('조사 제거 후 반환', () => {
    expect(koreanProcessTerm('카메라를')).toBe('카메라')
  })

  it('빈 문자열 → null', () => {
    expect(koreanProcessTerm('')).toBeNull()
  })
})
