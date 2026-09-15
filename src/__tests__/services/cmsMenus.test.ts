import { describe, it, expect } from 'vitest';
import {
  CMS_MENUS,
  hasMenuAccess,
  findCmsMenuByKey,
  findCmsMenuKeyForPath,
  roleAllowsMenuByDefault,
} from '$lib/constants/cmsMenus';

/**
 * TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 1 (Q1~Q3 확정 반영)
 *
 * hasMenuAccess(role, menuOverrides, menuKey) — Q3 확정 "블랙리스트 방식" 판정:
 *   ① 해당 menu_key에 대한 오버라이드 레코드가 없으면 → role 기준(hasRouteAccess() +
 *      requiresSettingsAccess 플래그) 결과를 그대로 따르는 기본 허용
 *   ② 명시적 차단(allowed=false) 레코드가 있을 때만 → role 결과와 무관하게 거부
 *   ③ (Q6 선반영) allowed=true 오버라이드가 있어도 role이 애초에 막은 메뉴를 열어주지 않음
 *      (좁히기 전용 — role은 항상 상한선, Stage 3 서버 불변조건과 동일 원칙을 판정 함수
 *      레벨에서도 먼저 보장)
 *
 * cmsMenus.ts는 src/routes/cms/+layout.svelte의 mainMenus 인라인 배열을 이관한 공유 상수
 * 모듈(SSOT)이며, 메뉴 목록을 GNB 렌더링과 신규 메뉴별 권한 UI 양쪽이 재사용한다.
 */

describe('CMS_MENUS — +layout.svelte mainMenus 이관 구조', () => {
  it('대메뉴 8개(dashboard 포함 — dashboard/consulting/rental/products/subscription/' +
    'customers/promotion/settings)로 구성된다', () => {
    // TASK.md 조사결과 E는 "대메뉴 9개"로 서술했으나 +layout.svelte mainMenus 실측(2026-08-25,
    // Stage 1 GREEN)은 8개다 — 실제 소스 배열 개수를 정본으로 삼는다.
    expect(CMS_MENUS).toHaveLength(8);
  });

  it('모든 메뉴 항목(대메뉴+서브메뉴)의 menu_key가 서로 중복되지 않는다', () => {
    const keys: string[] = [];
    for (const main of CMS_MENUS) {
      keys.push(main.menu_key);
      for (const sub of main.subMenus) keys.push(sub.menu_key);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('서브메뉴 항목이 약 24개(20개 이상) 존재한다(대여·상품·고객·프로모션·설정 등)', () => {
    const subMenuCount = CMS_MENUS.reduce((acc, main) => acc + main.subMenus.length, 0);
    expect(subMenuCount).toBeGreaterThanOrEqual(20);
  });

  it('findCmsMenuByKey — menu_key로 대메뉴·서브메뉴 어느 쪽이든 조회 가능하다', () => {
    expect(findCmsMenuByKey('products.list')?.href).toBe('/cms/products');
    expect(findCmsMenuByKey('dashboard')?.href).toBe('/cms');
    expect(findCmsMenuByKey('no-such-menu-key')).toBeUndefined();
  });
});

describe('hasMenuAccess — Q3 블랙리스트 방식 판정', () => {
  it('오버라이드 레코드가 없으면 role 기준 결과를 그대로 따른다(기본 허용)', () => {
    // '/cms/products'는 ROUTE_MIN_ROLE에 등록돼 있지 않고 requiresSettingsAccess도 아니라
    // partner도 role 그대로 통과한다
    expect(hasMenuAccess('partner', [], 'products.list')).toBe(true);
  });

  it('명시적 차단(allowed=false) 레코드가 있으면 role과 무관하게 거부한다', () => {
    const overrides = [{ menu_key: 'products.list', allowed: false }];
    // manager는 role상 '/cms/products' 접근 가능하지만, 명시적 차단 레코드가 우선한다
    expect(hasMenuAccess('manager', overrides, 'products.list')).toBe(false);
  });

  it('다른 menu_key의 차단 레코드는 영향을 주지 않는다(메뉴 단위로만 적용)', () => {
    const overrides = [{ menu_key: 'promotion.coupon', allowed: false }];
    expect(hasMenuAccess('partner', overrides, 'products.list')).toBe(true);
  });

  it('allowed=true 오버라이드가 있어도 role이 애초에 막은 메뉴를 열어주지 않는다(좁히기 전용, Q6 선반영)', () => {
    const overrides = [{ menu_key: 'settings.admin', allowed: true }];
    // '관리정보'(settings.admin)는 requiresSettingsAccess(manager+) 항목 — partner는 role상 불가
    expect(hasMenuAccess('partner', overrides, 'settings.admin')).toBe(false);
    // manager는 role상 통과 가능하므로 동일 오버라이드에서 true여야 한다(대조군)
    expect(hasMenuAccess('manager', overrides, 'settings.admin')).toBe(true);
  });

  it('존재하지 않는 menu_key는 방어적으로 거부한다', () => {
    expect(hasMenuAccess('superadmin', [], 'no-such-menu-key')).toBe(false);
  });
});

describe('roleAllowsMenuByDefault — 오버라이드를 무시한 순수 role 기준 판정 (Stage 3 재사용 대상)', () => {
  it('requiresSettingsAccess 메뉴는 manager+만 통과한다', () => {
    expect(roleAllowsMenuByDefault('partner', 'settings.admin')).toBe(false);
    expect(roleAllowsMenuByDefault('manager', 'settings.admin')).toBe(true);
  });

  it('requiresSettingsAccess가 없는 메뉴는 role과 무관하게 통과한다', () => {
    expect(roleAllowsMenuByDefault('partner', 'products.list')).toBe(true);
  });

  it('존재하지 않는 menu_key는 방어적으로 거부한다', () => {
    expect(roleAllowsMenuByDefault('superadmin', 'no-such-menu-key')).toBe(false);
  });
});

describe('findCmsMenuKeyForPath — pathname → menu_key 역매핑 (Stage 3, +layout.server.ts 오버레이용)', () => {
  it('정확히 일치하는 href를 menu_key로 반환한다', () => {
    expect(findCmsMenuKeyForPath('/cms/products')).toBe('products.list');
    expect(findCmsMenuKeyForPath('/cms/reservation')).toBe('rental.reservation');
  });

  it('하위 경로(디테일 뷰 등)는 가장 구체적인(가장 긴 href) 메뉴로 매칭된다', () => {
    // '/cms/products/abc-uuid'는 'products.new'(href '/cms/products/new')가 아니라
    // 'products.list'(href '/cms/products')에 매칭돼야 한다
    expect(findCmsMenuKeyForPath('/cms/products/abc-uuid')).toBe('products.list');
    expect(findCmsMenuKeyForPath('/cms/products/new')).toBe('products.new');
    expect(findCmsMenuKeyForPath('/cms/reservation/contracts')).toBe('rental.contracts');
  });

  it('대메뉴 dashboard(href /cms)는 정확히 /cms일 때만 매칭되고, 다른 CMS 경로의 접두사로 오매칭되지 않는다', () => {
    expect(findCmsMenuKeyForPath('/cms')).toBe('dashboard');
    expect(findCmsMenuKeyForPath('/cms/accounts')).toBeNull();
    expect(findCmsMenuKeyForPath('/cms/accounts/list')).toBeNull();
    expect(findCmsMenuKeyForPath('/cms/mobile')).toBeNull();
  });

  it('CMS_MENUS에 등록되지 않은 경로는 null을 반환한다(기존 role 전용 가드만 적용됨을 보장)', () => {
    expect(findCmsMenuKeyForPath('/cms/login')).toBeNull();
  });

  it('settings.code의 실제 목적지(/cms/codes)가 menu_key로 매핑된다(QA 정밀검수 결함② 수정 — ' +
    '스텁 경로가 아닌 실제 목적지에 오버레이가 적용돼야 URL 직접 접근 우회를 막을 수 있다)', () => {
    expect(findCmsMenuKeyForPath('/cms/codes')).toBe('settings.code');
  });

  it('구 스텁 경로(/cms/set/code)는 더 이상 CMS_MENUS에 매핑되지 않는다(href가 실제 목적지로 ' +
    '이전됨 — 스텁 자체는 /cms/codes로 302 리다이렉트만 수행하는 별도 파일, 수정 대상 아님)', () => {
    expect(findCmsMenuKeyForPath('/cms/set/code')).toBeNull();
  });
});

describe('QA 정밀검수(2026-08-26) 결함③ 수정 — role 기본값 정합성 16개 서브메뉴', () => {
  // 실제 목적지 페이지가 전부 hasSettingsAccess()(manager+) 게이트를 갖고 있음에도
  // requiresSettingsAccess 플래그가 빠져 roleAllowsMenuByDefault('partner', ...)가 잘못
  // true를 반환하던 항목들. partner는 false, manager는 true여야 한다(대조군).
  const menuKeys = [
    'customers.membership',
    'customers.score',
    'customers.inquiry',
    'customers.settings',
    'promotion.ad',
    'promotion.coupon',
    'promotion.point',
    'promotion.segment',
    'promotion.rules',
    'promotion.analytics',
    'promotion.content',
    'rental.contracts',
    'settings.code',
    'subscription.list',
    'subscription.new',
  ];

  it.each(menuKeys)('partner / %s → roleAllowsMenuByDefault는 false여야 한다', (menuKey) => {
    expect(roleAllowsMenuByDefault('partner', menuKey)).toBe(false);
  });

  it.each(menuKeys)('manager / %s → roleAllowsMenuByDefault는 true여야 한다(정상 허용 대조군)', (menuKey) => {
    expect(roleAllowsMenuByDefault('manager', menuKey)).toBe(true);
  });
});

describe('Stephen 지시(2026-09-15) — 파트너 접근범위 재조정 3건', () => {
  it('고객목록(customers.list)은 파트너도 열람 가능해야 한다(계정별 권한설정으로 On/Off — ' +
    '단, 블랙리스트·회원정보수정·점수조정·포인트지급·삭제 등 나머지 고객관리 액션은 여전히 manager+ 전용)', () => {
    expect(roleAllowsMenuByDefault('partner', 'customers.list')).toBe(true);
    expect(roleAllowsMenuByDefault('manager', 'customers.list')).toBe(true);
  });

  it('대여관리(settings.rental)는 이제 파트너에게 완전히 차단된다(메뉴 자체를 숨기고 라우트도 차단)', () => {
    expect(roleAllowsMenuByDefault('partner', 'settings.rental')).toBe(false);
    expect(roleAllowsMenuByDefault('manager', 'settings.rental')).toBe(true);
  });

  it('프로모션 대메뉴는 서브메뉴가 전부 role상 차단된 역할(예: 파트너)에게는 GNB에서 숨겨져야 한다 ' +
    '(hasMenuAccess 기준 서브메뉴 전부 거부 — +layout.svelte가 이 조건으로 대메뉴 자체를 숨긴다)', () => {
    const promotionSubKeys = CMS_MENUS.find((m) => m.menu_key === 'promotion')!.subMenus.map((s) => s.menu_key);
    expect(promotionSubKeys.length).toBeGreaterThan(0);
    for (const key of promotionSubKeys) {
      expect(hasMenuAccess('partner', [], key)).toBe(false);
    }
  });
});

describe('rental.change_cancel — 서버 액션 권한 체크 정합성 (2026-09-15)', () => {
  // changeReservation·updateStatus(cancelled 분기) 두 폼 액션이 hasSettingsAccess 역할 게이트
  // 통과 후 추가로 이 hasMenuAccess 결과를 사용해 403을 반환한다.
  // 핵심: manager+는 기본적으로 허용되지만, cms_menu_permissions 오버레이로 개별 차단 가능.

  it('manager는 오버라이드가 없으면 rental.change_cancel에 기본 접근 허용된다', () => {
    expect(hasMenuAccess('manager', [], 'rental.change_cancel')).toBe(true);
  });

  it('superadmin은 오버라이드 없이 rental.change_cancel에 접근 허용된다', () => {
    expect(hasMenuAccess('superadmin', [], 'rental.change_cancel')).toBe(true);
  });

  it('partner는 requiresSettingsAccess 플래그로 role 수준에서 rental.change_cancel이 차단된다', () => {
    // partner는 hasSettingsAccess()=false라 changeReservation/updateStatus 액션의
    // 첫 번째 게이트(역할 체크)에서 이미 막히지만, hasMenuAccess도 동일하게 false여야 함
    expect(hasMenuAccess('partner', [], 'rental.change_cancel')).toBe(false);
  });

  it('manager에게 allowed=false 오버라이드가 있으면 rental.change_cancel이 차단된다 — ' +
    '이것이 서버 액션이 fail(403)을 반환하는 정확한 조건이다', () => {
    const overrides = [{ menu_key: 'rental.change_cancel', allowed: false }];
    expect(hasMenuAccess('manager', overrides, 'rental.change_cancel')).toBe(false);
    // superadmin도 동일하게 차단됨
    expect(hasMenuAccess('superadmin', overrides, 'rental.change_cancel')).toBe(false);
  });

  it('다른 menu_key의 차단 오버라이드는 rental.change_cancel에 영향을 주지 않는다', () => {
    const overrides = [{ menu_key: 'rental.reservation', allowed: false }];
    expect(hasMenuAccess('manager', overrides, 'rental.change_cancel')).toBe(true);
  });

  it('allowed=true 오버라이드는 partner에게 rental.change_cancel을 열어주지 않는다(좁히기 전용)', () => {
    const overrides = [{ menu_key: 'rental.change_cancel', allowed: true }];
    expect(hasMenuAccess('partner', overrides, 'rental.change_cancel')).toBe(false);
  });
});
