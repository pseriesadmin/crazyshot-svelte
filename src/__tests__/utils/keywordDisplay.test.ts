import { describe, expect, it } from 'vitest'
import { truncateKeywordLabel } from '$lib/utils/keywordDisplay'

describe('truncateKeywordLabel', () => {
  it('10자 이하면 그대로 반환', () => {
    expect(truncateKeywordLabel('SONY')).toBe('SONY')
    expect(truncateKeywordLabel('Blackmagic')).toBe('Blackmagic')
    expect(truncateKeywordLabel('한글키워드123')).toBe('한글키워드123')
  })

  it('10자 초과 시 말줄임', () => {
    expect(truncateKeywordLabel('FeiyuTech SCORP Mini 2')).toBe('FeiyuTech …')
    expect(truncateKeywordLabel('CANON 100mm Macro')).toBe('CANON 100m…')
  })

  it('빈 문자열은 빈 문자열', () => {
    expect(truncateKeywordLabel('   ')).toBe('')
  })
})
