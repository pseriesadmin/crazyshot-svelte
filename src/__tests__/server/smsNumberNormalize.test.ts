/** sendSms 수신번호 정규화 — 하이픈뿐 아니라 숫자 외 문자(보이지 않는 방향 제어문자 등)를 제거해 Solapi에 보낸다 (2026-10-08) */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()
vi.mock('$app/environment', () => ({ dev: false }))
vi.mock('$env/dynamic/private', () => ({ env: { SOLAPI_API_KEY: 'k', SOLAPI_API_SECRET: 's', SMS_SENDER_PHONE: '02-1234-5678' } }))
vi.mock('solapi', () => ({
  SolapiMessageService: class { send = (a: unknown) => sendMock(a) },
}))

import { sendSms } from '$lib/server/sms'

beforeEach(() => { sendMock.mockReset().mockResolvedValue({ failedMessageList: [] }) })

describe('sendSms 번호 정규화', () => {
  it('하이픈·방향 제어문자(U+202D/U+202C)가 섞여도 숫자만 보낸다', async () => {
    await sendSms('‭010-7334-2012‬', '본문')
    expect(sendMock).toHaveBeenCalledWith({ to: '01073342012', from: '0212345678', text: '본문' })
  })

  it('숫자가 하나도 없으면 발송하지 않고 오류', async () => {
    await expect(sendSms('‭-‬', '본문')).rejects.toThrow('수신번호')
    expect(sendMock).not.toHaveBeenCalled()
  })
})
