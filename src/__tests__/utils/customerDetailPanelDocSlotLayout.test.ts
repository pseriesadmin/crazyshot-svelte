import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * CustomerDetailPanel 재등록 박스 — 서류 종류 선택기가 각 박스 안에 있어야 한다 (2026-10-03, QA BLOCKING 회귀 방지)
 * 완료기준: 본인증명 박스에는 identity 선택기만, 외국인증명 박스에는 foreign 선택기만 있고, 두 선택기가 서로의 박스에 섞이지 않는다.
 * (컴포넌트 마운트 없이 소스 구조로 검증 — 선택기 블록이 잘못된 박스에 삽입된 사고를 잡는다)
 */
const src = readFileSync('src/lib/components/cms/CustomerDetailPanel.svelte', 'utf-8')

function block(open: string, nextMarker: string): string {
  const i = src.indexOf(open)
  expect(i).toBeGreaterThan(-1)
  const j = src.indexOf(nextMarker, i + open.length)
  return src.slice(i, j > -1 ? j : undefined)
}

describe('CustomerDetailPanel — 재등록 박스 서류 종류 선택기 배치', () => {
  const identityBox = block('{#if reuploadIdentityOpen}', '{#if reuploadForeignOpen}')
  const foreignBox = block('{#if reuploadForeignOpen}', '<!-- 본인증명 파일 뷰어 -->')

  it('본인증명 박스: identity 선택기 1개, foreign 선택기 없음', () => {
    expect(identityBox.match(/<SuggestPicker/g)?.length).toBe(1)
    expect(identityBox).toContain('bind:selectedId={reuploadIdentitySlot}')
    expect(identityBox).toContain('options={IDENTITY_SLOT_OPTIONS}')
    expect(identityBox).not.toContain('reuploadForeignSlot')
    expect(identityBox).not.toContain('FOREIGN_SLOT_OPTIONS')
    expect(identityBox).toContain('id="doc-slot-identity"')
  })

  it('외국인증명 박스: foreign 선택기 1개, identity 선택기 없음', () => {
    expect(foreignBox.match(/<SuggestPicker/g)?.length).toBe(1)
    expect(foreignBox).toContain('bind:selectedId={reuploadForeignSlot}')
    expect(foreignBox).toContain('options={FOREIGN_SLOT_OPTIONS}')
    expect(foreignBox).not.toContain('reuploadIdentitySlot')
    expect(foreignBox).not.toContain('IDENTITY_SLOT_OPTIONS')
    expect(foreignBox).toContain('id="doc-slot-foreign"')
  })

  it('확인 버튼은 종류를 고르기 전에는 비활성(양쪽)', () => {
    expect(identityBox).toContain('!reuploadIdentitySlot')
    expect(foreignBox).toContain('!reuploadForeignSlot')
  })
})
