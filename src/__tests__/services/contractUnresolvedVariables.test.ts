// @vitest-environment node
/**
 * contractUnresolvedVariables.test.ts — CS2654 보완: 발송 전 잔존/치환불가 변수 탐지
 *
 * 배경: CMS 전역 정밀검증 v6에서 Production 계약서식("2026임대차계약서양식")이
 * 발송 시 {{변수명}} 원문이 그대로 남은 채 나가는 결함(계약서 6건, 그중 3건은 서명완료)이
 * 발견됐다. 발송 전 잔존변수를 자동으로 걸러내는 안전장치가 필요하다(Stephen GATE B Q7 승인).
 *
 * 대상: src/lib/utils/contract-substitution.ts
 *   - findUnresolvedVariables(content): 이미 저장된 콘텐츠(문자열 또는 JSON)에서 잔존
 *     {{변수명}} 스캔 — spreadsheet/flow 모드는 치환 실패 시 원문을 유지하므로 유효.
 *   - findHtmlUnresolvedVariables(html, data): html 모드 원본 템플릿을 대상으로 치환
 *     불가능한 변수를 사전에 찾음(치환 후에는 빈 문자열로 지워져 스캔 불가능하므로).
 */

import { describe, it, expect } from 'vitest'
import { findUnresolvedVariables, findHtmlUnresolvedVariables } from '$lib/utils/contract-substitution.js'
import type { ContractSubstitutionData } from '$lib/types/contract-module.js'

describe('findUnresolvedVariables — 저장된 콘텐츠의 잔존 {{}} 스캔', () => {
  it('문자열에 잔존 변수가 없으면 빈 배열', () => {
    expect(findUnresolvedVariables('고객이름: 김철수, 금액: 10,000원')).toEqual([])
  })

  it('문자열에 잔존 변수 1개 → 해당 변수명 반환', () => {
    expect(findUnresolvedVariables('발행일: {{계약서발행일}}')).toEqual(['계약서발행일'])
  })

  it('중복 변수는 1회만 반환(dedupe)', () => {
    expect(findUnresolvedVariables('{{차감포인트}} ... {{차감포인트}}')).toEqual(['차감포인트'])
  })

  it('JSON(spreadsheet_document 등 객체)도 stringify해서 스캔한다', () => {
    const doc = { sheets: [{ cells: [{ text: '{{지점옵션}}' }, { text: '정상값' }] }] }
    expect(findUnresolvedVariables(doc)).toEqual(['지점옵션'])
  })

  it('여러 개의 서로 다른 변수는 발견 순서대로 전부 반환', () => {
    expect(findUnresolvedVariables('{{A}} {{B}} {{A}}')).toEqual(['A', 'B'])
  })

  it('null/undefined 입력 시 빈 배열(안전 처리)', () => {
    expect(findUnresolvedVariables(null)).toEqual([])
    expect(findUnresolvedVariables(undefined)).toEqual([])
  })
})

describe('findHtmlUnresolvedVariables — html 모드 원본 템플릿 사전검증', () => {
  const baseData: ContractSubstitutionData = {
    고객이름: '김철수',
    기본대여요금: '100,000원',
  }

  it('모든 변수가 데이터에 있으면 빈 배열', () => {
    const html = '<p>{{고객이름}} / {{기본대여요금}}</p>'
    expect(findHtmlUnresolvedVariables(html, baseData)).toEqual([])
  })

  it('데이터에 없는 변수는 목록에 포함된다', () => {
    const html = '<p>{{고객이름}} / {{계약서발행일}}</p>'
    expect(findHtmlUnresolvedVariables(html, baseData)).toEqual(['계약서발행일'])
  })

  it('{{NO.}}/{{NO}}는 반복영역 순번이므로 항상 제외된다', () => {
    const html = '<tr>{{NO.}} {{NO}} {{계약서발행일}}</tr>'
    expect(findHtmlUnresolvedVariables(html, baseData)).toEqual(['계약서발행일'])
  })

  it('중복 변수는 1회만 반환', () => {
    const html = '{{할인반영금액}} ... {{할인반영금액}}'
    expect(findHtmlUnresolvedVariables(html, baseData)).toEqual(['할인반영금액'])
  })
})
