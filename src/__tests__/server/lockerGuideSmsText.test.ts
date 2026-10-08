/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
/** 무인보관함 안내 문자 문구·무인함 번호 규칙 (2026-10-08, Migration 678) */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('$app/environment', () => ({ dev: false }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('solapi', () => ({ SolapiMessageService: class {} }))

import { buildLockerGuideSms } from '$lib/server/sms'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8')

describe('buildLockerGuideSms', () => {
  it('형식: [크레이지샷] 상품명 대여예약 무인보관함 이용정보 No {무인함 번호} / {비밀번호}', () => {
    expect(buildLockerGuideSms('Sony FX6-12', '3', '12345678'))
      .toBe('[크레이지샷] Sony FX6-12 대여예약 무인보관함 이용정보 No 3 / 12345678')
  })
  it('무인함 번호가 없는 옛 데이터는 비밀번호만 안내한다', () => {
    expect(buildLockerGuideSms('카메라', null, '1234')).toBe('[크레이지샷] 카메라 대여예약 무인보관함 이용정보 1234')
    expect(buildLockerGuideSms('카메라', '  ', '1234')).toBe('[크레이지샷] 카메라 대여예약 무인보관함 이용정보 1234')
  })
  it('상품명이 없으면 "상품"으로 표기', () => {
    expect(buildLockerGuideSms(null, '2', '1234')).toContain('[크레이지샷] 상품 대여예약')
  })
})

describe('무인함 번호 + 비밀번호 필수 규칙(서버·화면)', () => {
  const api = read('src/routes/api/cms/reservations/[id]/locker-password/+server.ts')
  const test = read('src/routes/api/cms/reservations/[id]/locker-password/test-send/+server.ts')
  const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')

  it('저장 API: 둘 중 하나만 있으면 400, 번호 형식 검증, RPC에 번호 전달', () => {
    expect(api).toContain('(lockerPassword === null) !== (lockerNumber === null)')
    expect(api).toContain('isValidLockerNumber(lockerNumber)')
    expect(api).toContain('isValidLockerPassword(lockerPassword)')
    expect(api).toContain('p_locker_number:  lockerNumber')
  })
  it('시범 발송 API: 번호·비밀번호 모두 필수, 같은 문구 빌더 사용', () => {
    expect(test).toContain("if (!password || !lockerNumber)")
    expect(test).toContain('buildLockerGuideSms(productName, lockerNumber, password)')
  })
  it('화면: 번호 입력칸이 비밀번호 입력칸 왼쪽, 확정 버튼은 둘 다 입력돼야 활성', () => {
    expect(panel.indexOf('placeholder="무인함 번호 입력"')).toBeLessThan(panel.indexOf('placeholder="무인보관함 비밀번호 입력"'))
    expect(panel).toContain('!lockerPassword.trim() || !lockerNumber.trim()')
    expect(panel).toContain('sanitizeLockerInput(e.currentTarget.value)')
  })
})
