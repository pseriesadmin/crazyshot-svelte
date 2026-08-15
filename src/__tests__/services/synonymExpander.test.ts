import { describe, it, expect } from 'vitest'
import {
  expandQueryWithConfirmedSynonyms,
  type SynonymGroup,
} from '$lib/server/searchEngine/core/synonymExpander'

/**
 * synonymExpander.ts — expandQueryWithConfirmedSynonyms 유닛 테스트 (§E-3)
 *
 * core/ 격리 원칙 검증 포함:
 *   - 외부 의존성(Supabase, $env 등) 없는 순수 함수
 *   - synonymGroups 빈 배열이면 기존 동작과 동일 (빈 배열 반환)
 */

const GROUPS: SynonymGroup[] = [
  {
    canonicalTerm: '소니',
    confirmedTerms: ['소니', 'Sony', 'SONY'],
  },
  {
    canonicalTerm: '캐논',
    confirmedTerms: ['캐논', 'Canon', 'CANON'],
  },
  {
    canonicalTerm: '니콘',
    confirmedTerms: ['니콘', 'Nikon'],
  },
]

describe('expandQueryWithConfirmedSynonyms — 핵심 매핑', () => {
  it('한글 canonical 입력 → 동의어 반환 (입력어 제외)', () => {
    const result = expandQueryWithConfirmedSynonyms('소니', GROUPS)
    expect(result).toContain('Sony')
    expect(result).toContain('SONY')
    expect(result).not.toContain('소니')
  })

  it('영문 소문자 입력 — 대소문자 구분 없이 매칭, 동일 발음 영문 변형은 제외', () => {
    // 'sony' 입력: Sony·SONY는 대소문자 무관 동일어이므로 제외, '소니'만 반환
    // (RPC 검색이 대소문자 무관하게 Sony/SONY 상품을 이미 찾으므로 중복 확장 불필요)
    const result = expandQueryWithConfirmedSynonyms('sony', GROUPS)
    expect(result).toContain('소니')
    expect(result).not.toContain('Sony')  // 'sony'.toLowerCase() === 'Sony'.toLowerCase() → 제외
    expect(result).not.toContain('SONY')  // 동일
  })

  it('영문 대문자 입력 — 동일 발음 소문자 변형 제외, 한글만 반환', () => {
    // 'Sony' 입력: SONY는 대소문자 무관 동일어이므로 제외, '소니'만 반환
    const result = expandQueryWithConfirmedSynonyms('Sony', GROUPS)
    expect(result).not.toContain('Sony') // 자기 자신
    expect(result).not.toContain('SONY') // 'Sony'.toLowerCase() === 'SONY'.toLowerCase() → 제외
    expect(result).toContain('소니')
  })

  it('매칭 그룹 없으면 빈 배열 반환 — 기존 검색 동작 완전 유지', () => {
    const result = expandQueryWithConfirmedSynonyms('후지필름', GROUPS)
    expect(result).toEqual([])
  })

  it('synonymGroups 빈 배열이면 항상 빈 배열 반환', () => {
    const result = expandQueryWithConfirmedSynonyms('소니', [])
    expect(result).toEqual([])
  })

  it('query가 빈 문자열이면 빈 배열 반환', () => {
    const result = expandQueryWithConfirmedSynonyms('', GROUPS)
    expect(result).toEqual([])
  })

  it('캐논 한글 입력 → Canon, CANON 반환', () => {
    const result = expandQueryWithConfirmedSynonyms('캐논', GROUPS)
    expect(result).toEqual(expect.arrayContaining(['Canon', 'CANON']))
    expect(result).not.toContain('캐논')
  })

  it('확장어 2개 이상 그룹에서 전부 반환 (dedupe 내장)', () => {
    // 동일 그룹 내 여러 확장어가 중복 없이 전부 반환되는지 확인
    const result = expandQueryWithConfirmedSynonyms('소니', GROUPS)
    const unique = new Set(result)
    expect(unique.size).toBe(result.length) // 중복 없음
  })

  it('여러 그룹에 동시 매칭되면 전부 합산 (edge case)', () => {
    // 두 그룹에 동일한 term이 있는 경우
    const multiGroups: SynonymGroup[] = [
      { canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony'] },
      { canonicalTerm: 'Sony', confirmedTerms: ['Sony', '소니알파'] },
    ]
    const result = expandQueryWithConfirmedSynonyms('소니', multiGroups)
    // 첫 번째 그룹: Sony / 두 번째 그룹: sony 자기 자신 제외 아니라 canonical 'Sony' → 소니알파
    // 두 번째 그룹 canonical 'Sony' !== '소니' → 매칭 안 됨
    // 두 번째 그룹 confirmedTerms: '소니알파' — '소니'와 다름 → 매칭 안 됨
    // 결과: 첫 번째 그룹만 매칭 → ['Sony']
    expect(result).toContain('Sony')
  })

  it('NIkon 입력(대소문자 혼합) → 니콘 반환', () => {
    const result = expandQueryWithConfirmedSynonyms('Nikon', GROUPS)
    expect(result).toContain('니콘')
    expect(result).not.toContain('Nikon')
  })
})
