import { describe, it, expect } from 'vitest'
import {
  parseGroupComboMoves,
  codeGroupMoveErrorText,
  groupsLeftEmpty,
  MAX_GROUP_COMBO_MOVES,
} from '$lib/utils/codeGroupMove'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const C2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const mv = (combo: string, from = A, to = B) => ({ combo_row_id: combo, from_group_id: from, to_group_id: to })

describe('parseGroupComboMoves', () => {
  it('올바른 JSON 은 이동 목록으로 바꾼다', () => {
    expect(parseGroupComboMoves(JSON.stringify([mv(C1)]))).toEqual([mv(C1)])
  })
  it('같은 조합이 두 번 오면 마지막 것만 쓴다', () => {
    const out = parseGroupComboMoves(JSON.stringify([mv(C1, A, B), mv(C1, A, '33333333-3333-4333-8333-333333333333')]))
    expect(out).toHaveLength(1)
    expect(out?.[0].to_group_id).toBe('33333333-3333-4333-8333-333333333333')
  })
  it.each([
    ['깨진 JSON', '{'],
    ['배열 아님', '{}'],
    ['빈 배열', '[]'],
    ['uuid 아님', JSON.stringify([{ combo_row_id: 'x', from_group_id: A, to_group_id: B }])],
    ['출발=도착', JSON.stringify([mv(C1, A, A)])],
    ['필드 누락', JSON.stringify([{ combo_row_id: C1, from_group_id: A }])],
    ['객체 아님', JSON.stringify([1])],
  ])('%s 는 거절(null)', (_name, raw) => {
    expect(parseGroupComboMoves(raw)).toBeNull()
  })
  it(`${MAX_GROUP_COMBO_MOVES}개를 넘으면 거절`, () => {
    const many = Array.from({ length: MAX_GROUP_COMBO_MOVES + 1 }, (_, i) =>
      mv(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`),
    )
    expect(parseGroupComboMoves(JSON.stringify(many))).toBeNull()
  })
})

describe('codeGroupMoveErrorText', () => {
  it('DB 오류 코드를 화면 문구로 바꾼다', () => {
    expect(codeGroupMoveErrorText('DUPLICATE_COMBO')).toContain('같은 코드 조합')
    expect(codeGroupMoveErrorText('error: PARTNER_TYPE_MISMATCH')).toContain('협력사')
    expect(codeGroupMoveErrorText('ALREADY_UNDONE')).toContain('이미 되돌린')
  })
  it('모르는 오류·빈 값은 null', () => {
    expect(codeGroupMoveErrorText('something else')).toBeNull()
    expect(codeGroupMoveErrorText(null)).toBeNull()
  })
})

describe('groupsLeftEmpty', () => {
  const current = new Map<string, string[]>([
    [A, [C1, C2]],
    [B, []],
  ])
  it('조합이 전부 옮겨진 출발 그룹만 비는 것으로 본다', () => {
    expect(groupsLeftEmpty(current, [mv(C1), mv(C2)])).toEqual([A])
  })
  it('일부만 옮기면 비지 않는다', () => {
    expect(groupsLeftEmpty(current, [mv(C1)])).toEqual([])
  })
  it('원래 조합이 없던 그룹은 비는 것으로 보지 않는다', () => {
    expect(groupsLeftEmpty(current, [mv(C1, B, A)])).toEqual([])
  })
})
