// CMS GNB 메뉴 구조 — 단일 진실의 원천(SSOT)
//
// src/routes/cms/+layout.svelte의 mainMenus 인라인 배열을 이관한 공유 상수 모듈이다.
// GNB 렌더링(+layout.svelte)과 신규 "메뉴별 세부 접근권한" 저장·집행(cms_menu_permissions,
// Stage 3) 양쪽이 이 목록을 재사용한다 — 메뉴 목록을 두 곳에 따로 하드코딩하지 않는다.
//
// requiresSettingsAccess: true 인 항목은 기존 +layout.svelte에서 hasSettingsAccess(role)
// (manager 이상)로만 노출 여부를 결정하던 항목(구독 메뉴, 설정>푸시알림/관리정보)이다 —
// 아직 ROUTE_MIN_ROLE(cmsPermissions.ts)에는 등록돼 있지 않아 hasRouteAccess() 단독으로는
// 걸러지지 않으므로, hasMenuAccess()가 이 플래그를 role 판정에 함께 반영한다.
//
// .claude/harness/TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 1 (Q1~Q3)

import { hasRouteAccess, hasSettingsAccess } from '$lib/utils/cmsPermissions'

export interface CmsSubMenuDef {
  menu_key: string
  label: string
  href: string
  requiresSettingsAccess?: boolean
}

export interface CmsMainMenuDef {
  id: string
  menu_key: string
  label: string
  href?: string
  requiresSettingsAccess?: boolean
  subMenus: CmsSubMenuDef[]
}

/** hasMenuAccess()·findCmsMenuByKey()가 공통으로 다루는 조회 결과 형태(대메뉴·서브메뉴 공용) */
export interface CmsMenuLookup {
  menu_key: string
  label: string
  href?: string
  requiresSettingsAccess?: boolean
}

export const CMS_MENUS: CmsMainMenuDef[] = [
  { id: 'dashboard', menu_key: 'dashboard', label: '홈', href: '/cms', subMenus: [] },
  {
    id: 'consulting',
    menu_key: 'consulting',
    label: '상담',
    subMenus: [
      { menu_key: 'consulting.chat', label: '채팅', href: '/cms/chat' },
      { menu_key: 'consulting.qna', label: '빠른답변목록', href: '/cms/chat/qna' },
    ],
  },
  {
    id: 'rental',
    menu_key: 'rental',
    label: '대여',
    subMenus: [
      { menu_key: 'rental.reservation', label: '예약대여현황', href: '/cms/reservation' },
      { menu_key: 'rental.history', label: '이력관리', href: '/cms/rental/history' },
      { menu_key: 'rental.contracts', label: '계약서양식', href: '/cms/reservation/contracts', requiresSettingsAccess: true },
    ],
  },
  {
    id: 'products',
    menu_key: 'products',
    label: '상품',
    subMenus: [
      { menu_key: 'products.list', label: '상품목록', href: '/cms/products' },
      { menu_key: 'products.new', label: '상품등록', href: '/cms/products/new' },
    ],
  },
  {
    id: 'subscription',
    menu_key: 'subscription',
    label: '구독',
    requiresSettingsAccess: true,
    subMenus: [
      { menu_key: 'subscription.list', label: '구독목록', href: '/cms/subscriptions', requiresSettingsAccess: true },
      { menu_key: 'subscription.new', label: '구독등록', href: '/cms/subscriptions/new', requiresSettingsAccess: true },
    ],
  },
  {
    id: 'customers',
    menu_key: 'customers',
    label: '고객',
    subMenus: [
      { menu_key: 'customers.list', label: '고객목록', href: '/cms/customers', requiresSettingsAccess: true },
      { menu_key: 'customers.membership', label: '멤버십', href: '/cms/customers/membership', requiresSettingsAccess: true },
      { menu_key: 'customers.score', label: '스코어', href: '/cms/customers/score', requiresSettingsAccess: true },
      { menu_key: 'customers.inquiry', label: '빠른문의', href: '/cms/customers/inquiry', requiresSettingsAccess: true },
      { menu_key: 'customers.settings', label: '설정', href: '/cms/customers/settings', requiresSettingsAccess: true },
    ],
  },
  {
    id: 'promotion',
    menu_key: 'promotion',
    label: '프로모션',
    subMenus: [
      { menu_key: 'promotion.ad', label: '홍보', href: '/cms/promotion/ad', requiresSettingsAccess: true },
      { menu_key: 'promotion.coupon', label: '쿠폰', href: '/cms/promotion/coupon', requiresSettingsAccess: true },
      { menu_key: 'promotion.point', label: '포인트', href: '/cms/promotion/point', requiresSettingsAccess: true },
      { menu_key: 'promotion.segment', label: '세그먼트', href: '/cms/promotion/segment', requiresSettingsAccess: true },
      { menu_key: 'promotion.rules', label: '룰엔진', href: '/cms/promotion/rules', requiresSettingsAccess: true },
      { menu_key: 'promotion.analytics', label: '분석', href: '/cms/promotion/analytics', requiresSettingsAccess: true },
      { menu_key: 'promotion.content', label: '콘텐츠', href: '/cms/promotion/content', requiresSettingsAccess: true },
    ],
  },
  {
    id: 'settings',
    menu_key: 'settings',
    label: '설정',
    subMenus: [
      { menu_key: 'settings.code', label: '코드설정', href: '/cms/codes', requiresSettingsAccess: true },
      { menu_key: 'settings.rental', label: '대여관리', href: '/cms/set/rental' },
      { menu_key: 'settings.push', label: '푸시알림', href: '/cms/set/push', requiresSettingsAccess: true },
      { menu_key: 'settings.admin', label: '관리정보', href: '/cms/set/admin', requiresSettingsAccess: true },
    ],
  },
]

/** menu_key로 대메뉴·서브메뉴 어느 쪽이든 조회 (없으면 undefined) */
export function findCmsMenuByKey(menuKey: string): CmsMenuLookup | undefined {
  for (const main of CMS_MENUS) {
    if (main.menu_key === menuKey) {
      return {
        menu_key: main.menu_key,
        label: main.label,
        href: main.href,
        requiresSettingsAccess: main.requiresSettingsAccess,
      }
    }
    const sub = main.subMenus.find((s) => s.menu_key === menuKey)
    if (sub) return sub
  }
  return undefined
}

/**
 * 현재 URL(pathname)이 CMS_MENUS의 어느 메뉴에 해당하는지 역매핑한다(없으면 null).
 *
 * 가장 긴(가장 구체적인) href가 일치하는 항목을 우선한다 — 예: '/cms/products/abc-uuid'는
 * 'products.new'(href '/cms/products/new')가 아니라 'products.list'(href '/cms/products')에
 * 매칭돼야 한다. 대메뉴 'dashboard'(href '/cms')는 루트이므로 다른 모든 CMS 경로의 접두사가
 * 되어버려 오매칭을 유발한다 — 정확히 '/cms'일 때만 매칭시키고 prefix 매칭에서는 제외한다.
 *
 * `src/routes/cms/+layout.server.ts`가 이 함수로 pathname→menu_key를 찾은 뒤에만
 * hasMenuAccess() 오버레이를 적용한다 — CMS_MENUS에 등록되지 않은 경로(예: /cms/accounts,
 * /cms/mobile, /cms/login)는 null을 반환해 기존 role 전용 가드만 그대로 적용된다(회귀 없음).
 */
export function findCmsMenuKeyForPath(pathname: string): string | null {
  let bestKey: string | null = null
  let bestLen = -1

  for (const main of CMS_MENUS) {
    const candidates: CmsMenuLookup[] = [
      { menu_key: main.menu_key, label: main.label, href: main.href },
      ...main.subMenus,
    ]
    for (const candidate of candidates) {
      const href = candidate.href
      if (!href) continue
      const isRoot = href === '/cms'
      const matches = pathname === href || (!isRoot && pathname.startsWith(`${href}/`))
      if (matches && href.length > bestLen) {
        bestLen = href.length
        bestKey = candidate.menu_key
      }
    }
  }

  return bestKey
}

/** cms_menu_permissions 1행에 대응하는 최소 형태 (user_id·updated_at 등은 판정에 불필요) */
export interface CmsMenuPermissionOverride {
  menu_key: string
  allowed: boolean
}

/**
 * roleAllowsMenuByDefault — 오버라이드를 완전히 무시하고, role 하나만으로 이 메뉴에
 * 접근 가능한지 판정한다(hasRouteAccess + requiresSettingsAccess 조합).
 *
 * hasMenuAccess()의 "역할 기준 기본 허용" 판정과 동일 로직을 공유하기 위해 분리했다.
 * Stage 3(`/api/cms/accounts/[id]/menu-permissions`)가 "메뉴권한이 role 허용범위를 절대
 * 넘어설 수 없다"는 Q6 서버단 불변조건을 강제할 때도 이 함수를 그대로 재사용한다 —
 * role→메뉴 판정 로직을 두 곳(hasMenuAccess / Stage 3 API)에 따로 구현하지 않는다.
 */
export function roleAllowsMenuByDefault(role: string, menuKey: string): boolean {
  const menu = findCmsMenuByKey(menuKey)
  if (!menu || !menu.href) return false
  if (menu.requiresSettingsAccess && !hasSettingsAccess(role)) return false
  return hasRouteAccess(role, menu.href)
}

/**
 * hasMenuAccess — Q3 확정 "블랙리스트 방식" 판정
 *   ① 오버라이드 레코드가 없으면 role 기준 결과(roleAllowsMenuByDefault)를
 *      그대로 따르는 기본 허용
 *   ② 명시적 차단(allowed=false) 레코드가 있을 때만 role과 무관하게 거부
 *   ③ allowed=true 오버라이드는 role이 막은 메뉴를 열어주지 않는다(좁히기 전용, Q6 원칙을
 *      판정 함수 레벨에서도 보장 — Stage 3 서버 불변조건과 동일 방향)
 */
export function hasMenuAccess(
  role: string,
  menuOverrides: CmsMenuPermissionOverride[] | null | undefined,
  menuKey: string,
): boolean {
  const menu = findCmsMenuByKey(menuKey)
  if (!menu || !menu.href) return false

  const override = (menuOverrides ?? []).find((o) => o.menu_key === menuKey)
  if (override && override.allowed === false) return false

  return roleAllowsMenuByDefault(role, menuKey)
}
