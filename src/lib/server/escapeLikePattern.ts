/**
 * QR-CASE-1 후속: product_code를 .ilike()로 조회하는 모든 지점에서 사용.
 * '%'/'_'는 Postgres LIKE/ILIKE 와일드카드라, 스캔/URL 파라미터 값을 이스케이프 없이
 * 그대로 넘기면 카테고리 코드에 이 문자가 섞일 경우 여러 행에 매칭될 수 있다.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
