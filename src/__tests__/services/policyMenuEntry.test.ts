import { describe, it, expect } from 'vitest';
import { findCmsMenuByKey, findCmsMenuKeyForPath, roleAllowsMenuByDefault } from '$lib/constants/cmsMenus';

// 2026-10-15: '정책관리'가 /cms/codes 탭에서 설정 서브메뉴 독립 항목(/cms/set/policy)으로 분리됨
describe('설정 서브메뉴 — 정책관리', () => {
  it('settings.policy가 /cms/set/policy로 등록돼 있다', () => {
    const entry = findCmsMenuByKey('settings.policy');
    expect(entry?.href).toBe('/cms/set/policy');
    expect(entry?.label).toBe('정책관리');
  });

  it('경로 역매핑이 settings.policy를 돌려준다', () => {
    expect(findCmsMenuKeyForPath('/cms/set/policy')).toBe('settings.policy');
  });

  it('manager 이상만 기본 허용 — partner는 role상 불가(다른 설정 메뉴와 동일)', () => {
    expect(roleAllowsMenuByDefault('manager', 'settings.policy')).toBe(true);
    expect(roleAllowsMenuByDefault('superadmin', 'settings.policy')).toBe(true);
    expect(roleAllowsMenuByDefault('partner', 'settings.policy')).toBe(false);
  });
});
