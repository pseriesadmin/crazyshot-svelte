// 도움말 분류(help_category) — canned_responses의 "카테고리" 상위 분류, /help Order Faq 탭 소스

export const HELP_CATEGORIES = [
  { value: 'basic',   label: '기본 이용안내' },
  { value: 'members', label: '회원 및 결제안내' },
  { value: 'etc',     label: '기타 일반안내' },
] as const

export type HelpCategory = typeof HELP_CATEGORIES[number]['value']

export const VALID_HELP_CATEGORIES: string[] = HELP_CATEGORIES.map((c) => c.value)

export function getHelpCategoryLabel(value: string | null | undefined): string {
  if (!value) return '기타 일반안내'
  return HELP_CATEGORIES.find((c) => c.value === value)?.label ?? '기타 일반안내'
}
