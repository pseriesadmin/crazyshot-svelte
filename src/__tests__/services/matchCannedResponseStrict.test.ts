import { describe, it, expect } from 'vitest'
import { evaluateCannedMatch, matchCannedResponse } from '$lib/server/matchCannedResponse'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

/**
 * 자동답변 정밀 판정(균형 기준) — 2026-10-06
 *  배경: 한 단어만 겹쳐도 무관한 빠른답변이 나가 CS가 늘던 문제(Production 실사례 기반).
 *  원칙: ① 모르면 매칭하지 않는다 ② 다중 키워드 조합이 더 많이 설명하는 답변을 고른다
 *        ③ 판정 불가는 호출부가 "관리자 답변 대기 안내"로 처리할 수 있게 decision으로 알려준다.
 *  아래 후보·질문은 운영 데이터에서 실제 오매칭이 확인된 사례를 개인정보 없이 같은 구조로 일반화해 재구성한 것이다(고객 원문 아님).
 */

const mk = (id: string, title: string, keywords: string[], extra: Partial<CannedResponseForMatch> = {}): CannedResponseForMatch => ({
  id, title, content: `${title} 안내 본문입니다.`, category: null, shortcut: null, match_keywords: keywords, usage_count: 0, ...extra,
})

const candidates: CannedResponseForMatch[] = [
  mk('overseas', '대여 장비를 해외나 섬이나 깊은 산간지역으로 가져가도 되나요?', ['해외', '섬', '산간', '도서']),
  mk('range', '대여 가능 상품 범위', ['대여가능', '상품범위']),
  mk('deposit', '보증금은 얼마인가요?', ['보증금']),
  mk('discount', '장기 대여 할인이 가능한가요?', ['장기', '할인']),
  mk('lens', '렌즈캡이나 핫슈 커버 같은 작은 악세사리를 분실하면 어떻게 배상하나요?', ['분실', '배상', '악세사리']),
  mk('return', '반납 안내 기본', ['반납'], { shortcut: '/반납' }),
  mk('cancel', '예약 취소 안내', ['예약', '취소', '환불']),
  mk('login', '회원 가입 오류', ['로그인', '가입', '오류']),
  mk('minor', '미성년자 고객 이용 안내', ['미성년자', '청소년']),
  mk('reserve', '예약 확인 안내', ['예약확인', '예약조회']),
]

describe('운영 오매칭 사례 — 이제는 매칭하지 않는다', () => {
  const mustMiss: [string, string][] = [
    ['○○ 공연장에서 받고 거기서 퀵 보내도 되나요?', '"되나요" 한마디로 해외·섬 안내가 붙던 사례'],
    ['답변이 계속 엉뚱하게만 오네요', '불만 표현이 분실 배상 안내로 가던 사례'],
    ['ACME XT-100 카본 모노포드 + ZZ-90 비디오 헤드', '상품명·모델명 나열'],
    ["'홍길동' 회원 본인증명정보 등록 확인 요청", '시스템성 문구'],
    ['고객센터', '단어 하나로 엉뚱한 안내'],
    ['10일 11일 장비가 다르게 필요한데요', '일반어만 겹침'],
    ['안녕하세요', '인사만'],
  ]
  for (const [q, why] of mustMiss) {
    it(`미매칭: ${q} (${why})`, () => {
      expect(matchCannedResponse(q, candidates)).toBeNull()
      expect(evaluateCannedMatch(q, candidates).decision).not.toBe('answer')
    })
  }
})

describe('정상 질문은 계속 매칭된다', () => {
  const mustHit: [string, string][] = [
    ['예약취소는 어떻게 되나요?', 'cancel'],
    ['저 로그인이 안되요.', 'login'],
    ['보증금 얼마예요?', 'deposit'],
    ['장기로 빌리면 할인 되나요?', 'discount'],
    ['해외로 가져가도 되나요?', 'overseas'],
    ['반납은 어떻게 하나요', 'return'],
    ['카메라 렌즈캡을 분실했는데 배상은 어떻게 되나요?', 'lens'],
  ]
  for (const [q, id] of mustHit) {
    it(`매칭: ${q} → ${id}`, () => {
      expect(matchCannedResponse(q, candidates)?.id).toBe(id)
    })
  }
})

describe('다중 키워드 조합 — 더 많이 설명하는 답변을 고른다', () => {
  const pair: CannedResponseForMatch[] = [
    mk('fee', '환불 수수료 안내', ['환불', '수수료']),
    mk('period', '환불 기간 안내', ['환불', '기간']),
  ]
  it('환불 + 기간 → 기간 안내', () => {
    expect(matchCannedResponse('환불 기간이 궁금해요', pair)?.id).toBe('period')
  })
  it('환불 + 수수료 → 수수료 안내', () => {
    expect(matchCannedResponse('환불할 때 수수료가 있나요', pair)?.id).toBe('fee')
  })
  it('공통 단어(환불)만 있으면 어느 쪽도 고르지 않는다', () => {
    const r = evaluateCannedMatch('환불 문의드립니다', pair)
    expect(r.decision).not.toBe('answer')
  })
})

describe('동의어는 하나의 근거로만 센다', () => {
  const syn = [{ canonicalTerm: '파손', confirmedTerms: ['파손', '깨짐', '고장', '부러짐'] }]
  const c = [mk('damage', '파손 접수 안내', ['파손'])]
  it('동의어로 확장돼 매칭된다', () => {
    expect(matchCannedResponse('카메라가 고장났어요', c, syn)?.id).toBe('damage')
  })
  it('같은 뜻 단어를 여러 번 써도 근거는 1개 — 일반어와 섞이면 매칭하지 않는다', () => {
    const r = evaluateCannedMatch('깨짐 고장 부러짐 때문에 오늘 서울 날씨가 좋네요 여행 갑니다', c, syn)
    expect(r.decision).not.toBe('answer')
  })
})

describe('판정 결과(decision) — 호출부 로깅·대기 안내용', () => {
  it('answer: best와 근거 수치를 돌려준다', () => {
    const r = evaluateCannedMatch('보증금 얼마예요?', candidates)
    expect(r.decision).toBe('answer')
    expect(r.best?.id).toBe('deposit')
    expect(r.top[0].coverage).toBeGreaterThan(0.5)
    expect(r.top[0].evidence).toBeGreaterThan(0)
  })
  it('no_match: 후보 상위 목록과 사유를 남긴다', () => {
    const r = evaluateCannedMatch('답변이 계속 엉뚱하게만 오네요', candidates)
    expect(r.decision).toBe('no_match')
    expect(r.best).toBeNull()
    expect(typeof r.reason).toBe('string')
    expect(r.top.length).toBeLessThanOrEqual(3)
  })
  it('빈 입력·후보 없음은 no_match', () => {
    expect(evaluateCannedMatch('', candidates).decision).toBe('no_match')
    expect(evaluateCannedMatch('반납', []).decision).toBe('no_match')
  })
})

// ── 실데이터 평가(2026-10-06, 활성 빠른답변 42건 × 최근 고객 질문 59건)에서 확인한 사례 ──
describe('실데이터 평가에서 확인한 사례', () => {
  const real: CannedResponseForMatch[] = [
    mk('breakage', '장비 분실 시 즉시 조치 안내', ['파손', '고장', '망가짐', '깨짐'], { shortcut: '파손' }),
    mk('backup', '데이터 백업 서비스 안내', ['데이터백업', '메모리백업', '백업', '메모리'], { shortcut: '데이터백업' }),
    mk('lateReturn', '반납 지연 및 면책 기준', ['반납지연', '늦게반납', '연체', '밀려서']),
    mk('returnBasic', '반납 안내 기본', ['반납', '반납방법'], { shortcut: '반납' }),
    mk('overseasShip', '반납 신청 안내', ['크레이지배송', '배송반납']),
    mk('reserveCheck', '예약 확인 안내', ['예약확인', '예약내역'], { shortcut: '예약' }),
    mk('receiveIssue', '수령 직후 장비 이상 안내', ['장비이상', '이상', '누락']),
  ]
  it('"파손처리는 어떻게 하죠?" → 파손 안내 ("처리" 접미어는 분모에서 제외)', () => {
    expect(matchCannedResponse('파손처리는 어떻게 하죠?', real)?.id).toBe('breakage')
  })
  it('"제가 장비 반납을 했는데 데이터백업을 안해서요" → 백업 안내 (서술어는 분모에서 제외)', () => {
    expect(matchCannedResponse('제가 장비 반납을 했는데 데이터백업을 안해서요', real)?.id).toBe('backup')
  })
  it('"차가 밀려서 반납이 늦을 것 같습니다" → 반납 지연 안내', () => {
    expect(matchCannedResponse('차가 밀려서 반납이 늦을 것 같습니다', real)?.id).toBe('lateReturn')
  })
  it('"장비를 받았는데 이상이 있습니다" → 수령 직후 이상 안내 (과거형 어미 처리)', () => {
    expect(matchCannedResponse('장비를 받았는데 이상이 있습니다.', real)?.id).toBe('receiveIssue')
  })
  it('"대여 신청했는데 어떻게 하나요?" → 제목 단어("신청") 하나만 겹치면 매칭하지 않는다', () => {
    expect(matchCannedResponse('대여 신청했는데 어떻게 하나요?', real)).toBeNull()
  })
  it('"예약취소는 어떻게 되나요?" → "예약"만 설명되고 "취소"가 남으면 예약확인 안내로 보내지 않는다', () => {
    expect(matchCannedResponse('예약취소는 어떻게 되나요?', real)).toBeNull()
  })
})

