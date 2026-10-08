/**
 * TDD: AI 조력 생성기 — 고객 채팅 질문 마스킹 (2026-10-08)
 * 외부 AI로 나가는 모든 고객 문장은 이 함수를 반드시 거친다. 전화·이메일·예약코드·주소·성함·긴 숫자·URL을 제거하고 의미(주제어)는 남긴다.
 */
import { describe, it, expect } from 'vitest'
import { maskPersonalInfo, isSafeToSend } from '$lib/server/crazychat/assist/mask'

describe('maskPersonalInfo', () => {
  it('전화번호(하이픈·공백·붙여쓰기)를 지운다', () => {
    for (const t of ['010-1234-5678로 연락주세요', '연락처 010 1234 5678', '01012345678입니다', '+82 10-1234-5678']) {
      const m = maskPersonalInfo(t)
      expect(m).not.toMatch(/\d{3,}/)
      expect(m).toContain('[전화]')
    }
  })
  it('이메일·URL을 지운다', () => {
    expect(maskPersonalInfo('abc.def@gmail.com 으로 보내주세요')).toBe('[이메일] 으로 보내주세요')
    expect(maskPersonalInfo('https://crazyshot.kr/account?x=1 확인해주세요')).toBe('[주소링크] 확인해주세요')
  })
  it('예약코드를 지운다', () => {
    expect(maskPersonalInfo('CS2609001 예약 취소하고 싶어요')).toBe('[예약코드] 예약 취소하고 싶어요')
    expect(maskPersonalInfo('예약번호 CZ-123456 확인')).toContain('[예약코드]')
  })
  it('성함 표현을 지운다', () => {
    expect(maskPersonalInfo('성함은 홍길동입니다 반납 문의요')).not.toContain('홍길동')
    expect(maskPersonalInfo('저는 김철수 고객입니다')).not.toContain('김철수')
  })
  it('도로명·지번 주소를 지운다', () => {
    expect(maskPersonalInfo('서울특별시 강서구 양천로 418 1층으로 보내주세요')).not.toContain('양천로 418')
    expect(maskPersonalInfo('경기도 성남시 분당구 판교로 12번길 3')).toContain('[주소]')
  })
  it('6자리 이상 숫자열을 지운다(계좌·주민번호 등)', () => {
    expect(maskPersonalInfo('계좌 1234567890123 입니다')).not.toMatch(/\d{6,}/)
  })
  it('주제어(반납·퀵·결제 등)는 남긴다', () => {
    expect(maskPersonalInfo('010-1234-5678 반납 장소가 어디예요')).toContain('반납 장소가 어디예요')
  })
})

describe('isSafeToSend', () => {
  it('마스킹 후 남은 연락처형 패턴이 있으면 거부한다', () => {
    expect(isSafeToSend('반납 장소가 어디예요')).toBe(true)
    expect(isSafeToSend('01012345678')).toBe(false)
    expect(isSafeToSend('a@b.co')).toBe(false)
  })
})
