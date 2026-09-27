import { describe, it, expect } from 'vitest'
import {
  normalizeKeyValueList,
  serializeKeyValueList,
  formatKeyValueText,
} from '$lib/utils/keyValueList'

describe('normalizeKeyValueList', () => {
  it('배열형은 순서를 그대로 보존한다', () => {
    const raw = [
      { key: 'zebra', value: '1' },
      { key: 'apple', value: '2' },
      { key: 'mango', value: '3' },
    ]
    expect(normalizeKeyValueList(raw).map((i) => i.key)).toEqual(['zebra', 'apple', 'mango'])
  })
  it('레거시 객체형도 읽는다(Object.entries 순서)', () => {
    expect(normalizeKeyValueList({ a: '1', b: '2' })).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ])
  })
  it('중복 키는 허용(순서 보존)', () => {
    expect(normalizeKeyValueList([{ key: 'k', value: '1' }, { key: 'k', value: '2' }])).toHaveLength(2)
  })
  it('빈 key(공백 포함)는 제외한다', () => {
    expect(normalizeKeyValueList([{ key: '  ', value: 'x' }, { key: 'ok', value: 'y' }])).toEqual([
      { key: 'ok', value: 'y' },
    ])
  })
  it('null/undefined/문자열/숫자는 []', () => {
    for (const v of [null, undefined, 'x', 3, true]) expect(normalizeKeyValueList(v)).toEqual([])
  })
  it('잘못된 요소는 건너뛰고 값은 문자열화한다', () => {
    const raw = [null, 5, { key: 'n', value: 10 }, { key: 'u' }]
    expect(normalizeKeyValueList(raw)).toEqual([
      { key: 'n', value: '10' },
      { key: 'u', value: '' },
    ])
  })
})

describe('serializeKeyValueList', () => {
  it('빈 key 제외 후 배열을 반환하고 순서를 유지한다', () => {
    expect(
      serializeKeyValueList([
        { key: 'b', value: '1' },
        { key: '', value: 'x' },
        { key: 'a', value: '2' },
      ]),
    ).toEqual([
      { key: 'b', value: '1' },
      { key: 'a', value: '2' },
    ])
  })
})

describe('formatKeyValueText', () => {
  it('"key: value, key: value" 형식(값 없으면 key만)', () => {
    expect(formatKeyValueText([{ key: 'a', value: '1' }, { key: 'b', value: '' }])).toBe('a: 1, b')
  })
})
