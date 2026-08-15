/**
 * §B-2 — crossLingualPatternExtractor.ts 유닛 테스트 (최소 8케이스)
 *
 * 테스트 범위:
 *   1. 한글(영문) 기본 패턴 추출
 *   2. 영문(한글) 역방향 패턴 추출
 *   3. 괄호 없는 일반 텍스트 → 빈 배열
 *   4. 복수 쌍 동시 추출
 *   5. 숫자만 포함 괄호 → 오탐 방지 필터
 *   6. 빈 문자열 / null 입력
 *   7. 혼합 텍스트에서 선택적 추출
 *   8. 중복 쌍 제거
 *
 * DB 의존성 없음 — 순수 함수 테스트.
 */

import { describe, it, expect } from 'vitest'
import {
  extractBilingualPairs,
  type BilingualPair,
} from '$lib/server/searchEngine/core/crossLingualPatternExtractor'

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 결과에서 hangul+latin 쌍만 추출 (순서 무관 비교용) */
function sortedPairs(pairs: BilingualPair[]): BilingualPair[] {
  return [...pairs].sort((a, b) => a.hangul.localeCompare(b.hangul))
}

// ── 테스트 케이스 ─────────────────────────────────────────────────────────────

describe('extractBilingualPairs', () => {
  // 케이스 1: 한글(영문) 기본 패턴
  it('한글(영문) 패턴 추출 — 소니(Sony)', () => {
    const result = extractBilingualPairs('소니(Sony) 카메라 추천해주세요')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ hangul: '소니', latin: 'Sony' })
  })

  // 케이스 2: 영문(한글) 역방향 패턴
  it('영문(한글) 역방향 패턴 추출 — Sony(소니)', () => {
    const result = extractBilingualPairs('Sony(소니) 카메라가 인기있어요')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ hangul: '소니', latin: 'Sony' })
  })

  // 케이스 3: 괄호 없는 일반 텍스트 → 빈 배열
  it('괄호 없는 텍스트 → 빈 배열 반환', () => {
    expect(extractBilingualPairs('일반 텍스트만 있는 경우')).toEqual([])
    expect(extractBilingualPairs('카메라 렌즈 스트로보 조명')).toEqual([])
  })

  // 케이스 4: 복수 쌍 동시 추출
  it('복수 이중언어 쌍 동시 추출', () => {
    const result = sortedPairs(
      extractBilingualPairs('카메라(camera) 렌즈(lens) 추천해주세요'),
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hangul: '렌즈', latin: 'lens' })
    expect(result[1]).toEqual({ hangul: '카메라', latin: 'camera' })
  })

  // 케이스 5: 숫자만 있는 괄호 → 오탐 방지 필터
  it('괄호 안 순수 숫자만 있으면 오탐으로 무시', () => {
    expect(extractBilingualPairs('소니(123)')).toEqual([])
    expect(extractBilingualPairs('소니(2024)')).toEqual([])
    expect(extractBilingualPairs('렌즈(50)')).toEqual([])   // 순수 숫자만 — 영문자 없음
    // 참고: "렌즈(50mm)"는 "mm"가 영문자이므로 필터 통과 — 이는 의도된 동작
    //   (단위 측정값 오탐은 DB 등록 후 관리자 검토 단계에서 걸러냄)
  })

  // 케이스 6: 빈 문자열 / 공백 입력
  it('빈 문자열 또는 공백 → 빈 배열 반환', () => {
    expect(extractBilingualPairs('')).toEqual([])
    expect(extractBilingualPairs('   ')).toEqual([])
  })

  // 케이스 7: 혼합 텍스트에서 선택적 추출
  it('혼합 텍스트에서 이중언어 쌍만 선택 추출', () => {
    const text = '소니(Sony) 카메라 vs 캐논 렌즈(lens) 비교'
    const result = sortedPairs(extractBilingualPairs(text))
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ hangul: '렌즈', latin: 'lens' })
    expect(result[1]).toEqual({ hangul: '소니', latin: 'Sony' })
  })

  // 케이스 8: 중복 쌍 제거
  it('동일 쌍이 두 번 등장해도 결과에 1개만 포함', () => {
    // 한글(영문) + 영문(한글) 순서가 달라도 같은 쌍으로 처리
    const text = '소니(Sony) 배터리 Sony(소니) 충전기'
    const result = extractBilingualPairs(text)
    // 둘 다 hangul=소니, latin=Sony → 중복 제거
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ hangul: '소니', latin: 'Sony' })
  })

  // 케이스 9: Canon(캐논) 역방향 패턴 + 문장 컨텍스트
  it('Canon(캐논) 역방향 패턴', () => {
    const result = extractBilingualPairs('Canon(캐논) 카메라 잘 나와요')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ hangul: '캐논', latin: 'Canon' })
  })

  // 케이스 10: 영문 파트에 공백 포함 (예: "Nikon D850")
  it('괄호 안 영문 파트에 공백 포함 — 전체 표현 추출', () => {
    // 한글(영문+공백+숫자) 패턴 — 괄호 안에 여러 단어
    const result = extractBilingualPairs('니콘(Nikon D850) 좋은 카메라')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ hangul: '니콘', latin: 'Nikon D850' })
  })
})
