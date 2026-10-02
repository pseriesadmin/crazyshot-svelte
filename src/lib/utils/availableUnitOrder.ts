/**
 * 재배정 가용 재고(자식 유닛) 목록 정렬·자동 선택 규칙 — 서버(available-units)와
 * RentalDetailPanel 양쪽이 같은 순서를 쓰도록 단일 정본으로 둔다.
 *
 * 정렬: product_code 숫자 인식 오름차순(…0002 < …0010), 코드 없는 유닛은 맨 뒤.
 * 자동 선택: 정렬된 가용 목록의 첫 항목(= 가장 낮은 순번).
 */
export interface UnitOption {
  id: string
  product_code: string | null
}

function compareCode(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

export function sortUnitsByCode<T extends UnitOption>(units: readonly T[]): T[] {
  return [...units].sort((x, y) => compareCode(x.product_code, y.product_code))
}

export function pickLowestUnit<T extends UnitOption>(units: readonly T[]): T | null {
  return sortUnitsByCode(units)[0] ?? null
}
