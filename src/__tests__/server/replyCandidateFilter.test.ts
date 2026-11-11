import { describe, it, expect } from 'vitest'
import { judgeReplyCandidate, containsPersonalInfo } from '$lib/server/crazychat/replyCandidateFilter'

// 운영 후보 목록(2026-11-10)에서 확인된 실제 유형을 고정한 회귀 테스트

describe('judgeReplyCandidate — 걸러야 하는 유형', () => {
  const drop: [string, string, string, string][] = [
    ['이미지 파일명+주소만', 'IMG_7258.jpeg\nhttps://x.supabase.co/storage/v1/object/public/chat-attachments/a/1.jpeg', '고객님 사진 확인했습니다. 안내드리겠습니다 감사합니다', 'attachment_only'],
    ['본인증명 정형문', '본인증명 서류 승인 문의드립니다.', '고객님 서류중 주민등록등본이 3개월 이내 서류가 아니라 인증이 반려되었습니다', 'system_phrase'],
    ['회원 아이디 포함 시스템문(개인정보가 우선)', "'배정민' 회원 본인증명정보 등록 확인 요청", '고객님 등본 3개월이내 서류 재제출 부탁드립니다', 'personal_info'],
    ['업로드 완료 보고', '업로드했습니다 확인부탁드려요', '고객님 서류확인 결과 재학증명서 발급기간이 3개월이 지나 확인이 되지 않습니다 재제출 부탁', 'system_phrase'],
    ['인사성 답변(짧은 확인)', '네네 알겠습니다! 연락주세욥ㅠㅠ', '네 감사합니다', 'low_value'],
    ['개인 호칭', '용희님 오늘 예약이 있는지요?', '아.. 넵 이기성입니다. 확인 후 안내드리겠습니다 감사합니다', 'personal_info'],
    ['전화번호', '연락처는 010-1234-5678 입니다', '확인 후 연락드리겠습니다 고객님 감사합니다 좋은 하루', 'personal_info'],
    ['보관함 번호 보고', '1번 보관함에 두었습니다!', '운송정보를 전달해주세요 확인 후 처리하겠습니다', 'individual_case'],
    ['완료 보고', '넣었습니다. 확인부탁드려요', '감사합니다 예약이 확정되었습니다 안내드리겠습니다', 'individual_case'],
    ['짝 불일치', '예약취소가 왜 되나요?', 'Samsung S26 울트라 512GB 모델이며 색상은 코발트 바이올렛 입니다 안내드립니다', 'pair_mismatch'],
    ['상품명만 있는 답변', '혹시 동일한 일정으로 렌즈만 빌리려고 하는데 호환되는 줌렌즈 알 수 있을까요?', 'Canon EF 24-105 F4 L IS USM', 'low_value'],
  ]
  for (const [name, c, r, reason] of drop) {
    it(`${name} → ${reason}`, () => {
      const v = judgeReplyCandidate(c, r)
      expect(v.keep).toBe(false)
      expect(v.reason).toBe(reason)
    })
  }
})

describe('judgeReplyCandidate — 남겨야 하는 유형', () => {
  const keep: [string, string, string][] = [
    ['반납 방법 안내', '퀵으로 반납하려면 어떻게 해야 하나요?', '퀵서비스로 반납하시는 경우 반납 시간인 오후 9시까지 매장에서 전달받을 수 있게 출발 전에 채팅으로 기사님 연락처를 남겨주시면 됩니다.'],
    ['백업 방법', '촬영한 영상은 매장에서 백업 가능한가요?', '매장 내에서 마이박스로 백업 가능합니다. 방문하시면 영상 파일을 옮기실 수 있도록 안내드립니다.'],
    ['아이폰 영상 재생 이용방법', '변환된 영상 재생 방법이 궁금합니다', '아이폰에서는 아래 순서대로 진행해 주세요. 1. 파일 앱에서 영상을 선택 2. 공유 버튼을 눌러 저장하시면 재생됩니다.'],
  ]
  for (const [name, c, r] of keep) {
    it(name, () => {
      const v = judgeReplyCandidate(c, r)
      expect(v.reason).toBeNull()
      expect(v.keep).toBe(true)
    })
  }
})

describe('judgeReplyCandidate — 고객 메시지가 인사뿐', () => {
  it('인사·감사만 있는 고객 메시지 → greeting_ack', () => {
    const v = judgeReplyCandidate('안녕하세요 감사합니다 네', '고객님 예약 관련 안내드립니다. 반납은 오후 9시까지 가능합니다.')
    expect(v.reason).toBe('greeting_ack')
  })
})

describe('judgeReplyCandidate — 정책·이용 안내는 개인정보로 오판하지 않음', () => {
  const keep: [string, string][] = [
    ['배터리 추가 대여 가능한가요?', '배터리는 추가 옵션으로 1개당 5,000원에 대여 가능합니다. 예약 시 옵션에서 추가해 주세요.'],
    ['퀵으로 받으면 얼마나 걸리나요?', '퀵으로 2시간 이내 도착하며 비용은 실시간 요금으로 청구됩니다. 거리와 시간대에 따라 달라집니다.'],
    ['보증금이 있나요?', '보증금은 별도로 받지 않으며 파손 시에만 수리비가 청구됩니다. 자세한 내용은 이용약관을 확인해 주세요.'],
    ['카드 결제 할부 되나요?', '카드로 3개월 무이자 할부가 가능합니다. 결제 단계에서 카드사를 선택해 주세요.'],
    ['영업시간이 어떻게 되나요?', '매장 영업시간은 오전 9시부터 오후 10시까지이며 그 이후에는 무인보관함으로 반납하시면 됩니다.'],
    ['반납 연장 가능한가요?', '죄송합니다만 연장은 다음 예약이 없는 경우에만 가능하며 마이페이지에서 연장 요청을 해주시면 안내드립니다.'],
  ]
  for (const [c, r] of keep) {
    it(c, () => expect(judgeReplyCandidate(c, r).keep).toBe(true))
  }
})

describe('containsPersonalInfo', () => {
  it('일반 호칭(고객님)은 개인정보가 아님', () => {
    expect(containsPersonalInfo('고객님 안녕하세요')).toBe(false)
  })
  it('이메일·전화·이름+님은 개인정보', () => {
    expect(containsPersonalInfo('a@b.com')).toBe(true)
    expect(containsPersonalInfo('01012345678')).toBe(true)
    expect(containsPersonalInfo('김철수님 안녕하세요')).toBe(true)
  })
  it('도로명 주소(지역어+도로명+번호)는 개인정보', () => {
    expect(containsPersonalInfo('서울특별시 강남구 테헤란로 152 로 보내주세요')).toBe(true)
  })
  it('안내문 속 숫자 표현은 개인정보가 아님', () => {
    for (const t of ['순서대로 2번 진행하시면 됩니다', '순서대로 2가지 방법이 있습니다', '문자로 1통 발송됩니다', '카드로 2장까지 결제 가능합니다', '택배로 2건 이상 가능', '세트로 2세트 대여 가능', '1588-1234 로 문의하세요', '2026-11-10 ~ 2026-11-12 기간', '손님이 선택하시면']) {
      expect(containsPersonalInfo(t), t).toBe(false)
    }
  })
  it('지번 주소는 개인정보, 으로/로 + 숫자 안내문은 아님', () => {
    expect(containsPersonalInfo('정발산동 1173-1 에서 출발')).toBe(true)
    expect(containsPersonalInfo('옵션으로 1개당 5,000원')).toBe(false)
    expect(containsPersonalInfo('자동 2회 이동 3일')).toBe(false)
  })
  it('날짜·가격 숫자는 개인정보가 아님', () => {
    expect(containsPersonalInfo('11월 20일에 15000원 입니다')).toBe(false)
  })
})
