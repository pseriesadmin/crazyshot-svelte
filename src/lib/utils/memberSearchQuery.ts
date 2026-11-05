// memberSearchQuery.ts — 회원 검색어 정리 (비회원 상담 병합 대상 검색용, 2026-11-05)
// PostgREST or() 필터 문법(, ( ) 따옴표)과 LIKE 와일드카드(% _ \)로 쓰이는 문자를 제거해 검색어가 필터 구조를 깨지 못하게 한다.

export const MEMBER_SEARCH_MIN = 2
export const MEMBER_SEARCH_MAX = 60

export function sanitizeMemberQuery(raw: string): string {
  return raw.replace(/[,()%_*\\"'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MEMBER_SEARCH_MAX)
}
