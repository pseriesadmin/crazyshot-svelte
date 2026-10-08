// topics.ts — 크레이지챗이 절대 답하지 않고 항상 사람에게 넘기는 주제 판별 (서버 전용, 순수 함수)
//
// 정책(Stephen 확정 2026-10-07): 파손·분실·환불·예약 취소·법적 분쟁·결제 오류·개인정보 요청 + 기존 민감 카테고리(cs=불만·컴플레인).
// 코드 값은 settings.ts의 HUMAN_ONLY_TOPICS와 같다. 이 판별은 "조회·접수·AI 답변" 모든 능력의 공통 선행 관문이다.
// 키워드 기반이라 놓칠 수 있으므로(재현율 한계) 각 능력은 자기 허용 목록(화이트리스트)도 따로 갖는다 — 여기는 "추가 안전망"이다.

import { HUMAN_ONLY_TOPICS } from './settings'

interface TopicRule {
  topic: (typeof HUMAN_ONLY_TOPICS)[number]
  re: RegExp
}

// 우선순위 순서(법적·파손·분실이 환불·취소보다 먼저). 정규식은 공백·조사 변형을 감안해 느슨하게 작성.
const RULES: readonly TopicRule[] = [
  { topic: 'legal', re: /소송|고소|고발|법적|변호사|소비자\s?원|손해\s?배상|내용\s?증명|경찰/ },
  { topic: 'damage', re: /파손|고장|깨졌|깨짐|깨져|망가|부서|부러|침수|물에\s?빠|떨어뜨|스크래치|긁혀|긁힘|긁었|흠집|찍힘|금\s?갔|액정|작동\s?(안|불량)|안\s?켜|먹통|불량/ },
  { topic: 'lost', re: /분실|잃어\s?버|도난|없어졌|사라졌/ },
  { topic: 'payment_error', re: /결제.{0,8}(오류|실패|에러|안\s?(돼|됐|되|된|됬|뜨|넘어)|이중|두\s?번|중복|잘못)|(이중|중복|잘못|두\s?번)\s?결제|결제가\s?안|(결제|입금)\s?(했|하였).{0,20}(안|못|없|반영)|카드.{0,6}(오류|승인\s?거절)|결제\s?(가\s?)?(두|2)\s?번/ },
  { topic: 'refund', re: /환불|환급|돌려\s?받|돌려\s?주|돈\s?(을\s?)?(돌려|반환)|반환\s?요청|취소\s?수수료/ },
  { topic: 'cancel', re: /취소|캔슬|해지|그만\s?(할|하|둘|두|쓸|쓰)|안\s?(쓸|쓰게|빌릴|빌리게|갈)|포기|못\s?(가게|쓰게|빌리게)/ },
  {
    topic: 'personal_info',
    re: /(개인\s?정보|주민\s?(등록\s?)?번호|전화\s?번호|연락처|카드\s?번호|계좌\s?번호|이메일|비밀\s?번호).{0,8}(알려|보여|조회|확인해|말해|수정|변경|삭제)|(알려|보여|말해).{0,8}(개인\s?정보|주민\s?번호|전화\s?번호|연락처)|다른\s?(고객|사람|분|사용자|손님)|타인|남의\s?(예약|정보)|모든\s?(예약|고객)|이전\s?(지시|명령).{0,6}무시|시스템\s?프롬프트/,
  },
  { topic: 'cs', re: /불만|항의|컴플레인|클레임|사기|짜증|화가\s?나|어이없|최악|엉망/ },
]

/** 사람 전용 주제에 해당하면 그 코드, 아니면 null. 입력은 고객 원문(데이터로만 취급, 저장하지 않는다). */
export function detectHumanOnlyTopic(message: string | null | undefined): string | null {
  if (typeof message !== 'string' || !message.trim()) return null
  for (const rule of RULES) {
    if (rule.re.test(message)) return rule.topic
  }
  return null
}
