import type { CodeFormat } from './+page.server'

export const ROOT_COLORS: Record<string, string> = {
  CAM: '#FF4500', OPT: '#3B2F8A', LGT: '#F59E0B', AUD: '#0EA5E9',
  SPT: '#10B981', MON: '#6366F1', PWR: '#EC4899', MED: '#8B5CF6',
  STD: '#14B8A6', VID: '#F97316', ACC: '#84CC16', PKG: '#06B6D4',
}

export const PRODUCT_CATS = [
  { value: 'camera',     label: '카메라' },
  { value: 'lens',       label: '렌즈' },
  { value: 'camcorder',  label: '캠코더' },
  { value: 'action_cam', label: '액션캠' },
  { value: 'drone',      label: '드론' },
  { value: 'lighting',   label: '조명' },
  { value: 'audio',      label: '오디오' },
  { value: 'accessory',  label: '악세서리' },
  { value: 'package',    label: '패키지' },
]

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
