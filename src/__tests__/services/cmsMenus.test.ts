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
    expect(findCmsMenuKeyForPath('/cms/codes')).toBeNull();
  });
});
