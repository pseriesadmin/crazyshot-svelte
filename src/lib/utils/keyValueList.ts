/**
 * keyValueList — products.components / products.specifications 저장 형식 유틸.
 *
 * 저장 형식: 순서 보존 배열 [{key, value}] (JSONB 객체는 키 순서를 보존하지 않음 — products.md §4-1).
 * 레거시 객체 형식 {"키":"값"}은 읽기 호환만 하며, 다음 저장 때 배열로 전환된다.
 */

export interface KeyValueItem {
  key: string
  value: string
}

function toText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/** 배열형·레거시 객체형 모두 [{key,value}]로 정규화. 빈 key 제외, null/잘못된 값은 []. */
export function normalizeKeyValueList(raw: unknown): KeyValueItem[] {
  if (Array.isArray(raw)) {
    const out: KeyValueItem[] = []
    for (const el of raw) {
      if (!el || typeof el !== 'object' || Array.isArray(el)) continue
      const rec = el as Record<string, unknown>
      const key = toText(rec.key)
      if (!key.trim()) continue
      out.push({ key, value: toText(rec.value) })
    }
    return out
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([k]) => k.trim())
      .map(([key, value]) => ({ key, value: toText(value) }))
  }
  return []
}

/** 저장용 배열 — 빈 key 항목 제외, 순서·중복 키 보존. */
export function serializeKeyValueList(items: readonly KeyValueItem[]): KeyValueItem[] {
  return items.filter((i) => i.key.trim()).map((i) => ({ key: i.key, value: i.value }))
}

/** "key: value, key: value" (값이 비면 key만). */
export function formatKeyValueText(list: readonly KeyValueItem[]): string {
  return list.map((i) => (i.value.trim() ? `${i.key}: ${i.value}` : i.key)).join(', ')
}
