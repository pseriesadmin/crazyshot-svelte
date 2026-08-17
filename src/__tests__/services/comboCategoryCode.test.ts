import { describe, it, expect } from 'vitest';
import { buildComboCategoryCode, sortByTier, getRootCode } from '$lib/utils/comboCategoryCode';

/**
 * /cms/customers '설정' 화면의 회원코드 코드조합 기준설정(saveMemberCodeCombo)이 접두어
 * 계산에 재사용하는 순수 유틸(comboCategoryCode.ts) 단독 검증.
 *
 * 이 유틸의 출력(prefix)은 이후 member_code_sequences.member_type(VARCHAR(30), migration 276)
 * 채번에 그대로 쓰인다 — 조합 결과가 뒤틀리면(정렬 순서 오류 등) 저장 시점의 30자 가드
 * (+page.server.ts saveMemberCodeCombo)나 DB 채번 자체가 예상과 다른 값으로 동작하므로,
 * 정렬·합산 로직 자체를 별도로 고정해둔다.
 */

describe('sortByTier — 대→중→소 정렬', () => {
  it('code_tier가 있으면 major → middle → minor 순으로 정렬한다', () => {
    const codes = [
      { id: '1', code: 'SLR', code_tier: 'minor' },
      { id: '2', code: 'CAM', code_tier: 'major' },
      { id: '3', code: 'DSL', code_tier: 'middle' },
    ];
    const sorted = sortByTier(codes);
    expect(sorted.map((c) => c.id)).toEqual(['2', '3', '1']);
  });

  it('code_tier가 없으면 depth로 폴백해 동일하게 정렬한다(0=major,1=middle,그 외=minor)', () => {
    const codes = [
      { id: 'a', code: 'X', depth: 2 },
      { id: 'b', code: 'Y', depth: 0 },
      { id: 'c', code: 'Z', depth: 1 },
    ];
    const sorted = sortByTier(codes);
    expect(sorted.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('buildComboCategoryCode — 접두어 합산', () => {
  it('대→중→소 순으로 code를 이어붙여 대문자로 반환한다', () => {
    const result = buildComboCategoryCode([
      { id: '1', code: 'slr', code_tier: 'minor' },
      { id: '2', code: 'cam', code_tier: 'major' },
    ]);
    expect(result).toBe('CAMSLR');
  });

  it('빈 배열이면 빈 문자열을 반환한다', () => {
    expect(buildComboCategoryCode([])).toBe('');
  });

  it('code가 없는(falsy) 항목은 결과에서 제외된다', () => {
    const result = buildComboCategoryCode([
      { id: '1', code: 'CAM', code_tier: 'major' },
      { id: '2', code: '', code_tier: 'middle' },
    ]);
    expect(result).toBe('CAM');
  });

  // 회귀 방지 — migration 276이 member_code_sequences.member_type을 VARCHAR(2)→VARCHAR(30)로
  // 확장한 원인이 된 시나리오(여러 단계 분류코드가 이어붙어 2자를 초과하는 접두어가 만들어짐)를
  // 유틸 레벨에서 고정해, 향후 정렬 로직 변경이 이 특성을 깨지 않는지 확인한다.
  it('3단계 이상 조합 시 2자를 초과하는 접두어가 만들어질 수 있다(저장 액션의 30자 가드 전제)', () => {
    const result = buildComboCategoryCode([
      { id: '1', code: 'DSL', code_tier: 'minor' },
      { id: '2', code: 'CAM', code_tier: 'major' },
      { id: '3', code: 'REN', code_tier: 'middle' },
    ]);
    expect(result).toBe('CAMRENDSL');
    expect(result.length).toBeGreaterThan(2);
  });
});

describe('getRootCode — 최상위(대분류) 코드', () => {
  it('정렬 후 첫 번째(대분류) 코드를 반환한다', () => {
    const root = getRootCode([
      { id: '1', code: 'SLR', code_tier: 'minor' },
      { id: '2', code: 'CAM', code_tier: 'major' },
    ]);
    expect(root?.id).toBe('2');
  });

  it('빈 배열이면 null을 반환한다', () => {
    expect(getRootCode([])).toBeNull();
  });
});
