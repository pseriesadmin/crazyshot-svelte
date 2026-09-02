import type { CodeFormat } from './+page.server'

export const ROOT_COLORS: Record<string, string> = {
  CAM: '#FF4500', OPT: '#3B2F8A', LGT: '#F59E0B', AUD: '#0EA5E9',
  SPT: '#10B981', MON: '#6366F1', PWR: '#EC4899', MED: '#8B5CF6',
  STD: '#14B8A6', VID: '#F97316', ACC: '#84CC16', PKG: '#06B6D4',
}

// ⛔ 2026-09-03 버그 수정: 이 파일이 재노출하던 PRODUCT_CATS(정적 9종 하드코딩,
// $lib/utils/productCategoryTaxonomy.ts)는 실제 등록 상품과 어긋나 있어 제거함 —
// 유일한 소비처였던 _MappingTab.svelte는 이제 load()가 내려주는 productCountMap
// (실제 등록 상품 집계)으로 카테고리 목록을 직접 계산한다. TASK.md 참고.

export function datePart(fmt: string): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return fmt === 'YYYYMM' ? `${yyyy}${mm}` : `${yy}${mm}`
}

export function buildPreview(catCode: string, fmt: CodeFormat): string {
  const prefix = (fmt.prefix ?? 'CS').trim().toUpperCase()
  const dateFormat = fmt.date_format ?? 'YYMM'
  const seqDigits = fmt.seq_digits ?? 3
  const suffix = (fmt.suffix ?? '').trim().toUpperCase()
  const d = dateFormat === 'NONE' ? '' : datePart(dateFormat)
  const s = '1'.padStart(seqDigits || 3, '0')
  const code = catCode.trim().toUpperCase()
  return `${prefix || 'CS'}${code}${d}${s}${suffix}`
}
