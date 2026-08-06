import { describe, it, expect } from 'vitest';
import { matchCannedResponse } from '$lib/server/matchCannedResponse';
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse';

/**
 * 자동답변 QnA — matchCannedResponse 순수함수 테스트
 * 하이브리드 자동답변 1단계: Claude 의도분류보다 먼저 실행되는 순수 키워드 매칭.
 * intent/category 개념 없음 — Claude 호출·API 키 상태와 무관하게 등록된 빠른답변 전체를
 * 대상으로 스코어링한다(카테고리 필터 없음).
 *
 * 확인 없이 고객에게 바로 발송되는 기능이라 재현율보다 정밀도를 우선한다
 * (score >= 3 미만은 미매칭 → 2단계 AI 파이프라인으로 폴백).
 */

const candidates: CannedResponseForMatch[] = [
  { id: 'r1', title: '반납 안내 기본', content: '반납은 택배 또는 직접 방문으로 가능합니다.', category: 'return', shortcut: '/반납', match_keywords: [], usage_count: 10 },
  { id: 'r2', title: '연장 요청 안내', content: '렌탈 기간 연장은 반납일 전날까지 요청 가능합니다.', category: 'return', shortcut: '/연장', match_keywords: [], usage_count: 5 },
  { id: 'p1', title: '결제 방법 안내', content: '카드·계좌이체·포인트 결합결제가 가능합니다.', category: 'payment', shortcut: '/결제', match_keywords: [], usage_count: 3 },
  { id: 'g1', title: '일반 문의', content: '문의 주셔서 감사합니다.', category: 'general', shortcut: null, match_keywords: [], usage_count: 1 },
  { id: 'd1', title: '파손 접수 안내', content: '파손 부위 사진을 보내주시면 확인 후 절차를 안내해 드립니다.', category: 'damage', shortcut: '/파손', match_keywords: ['고장', '깨짐', '망가졌'], usage_count: 2 },
];

describe('matchCannedResponse', () => {
  it('shortcut 부분일치(+3)로 매칭 성공', () => {
    const result = matchCannedResponse('연장을 하고 싶어.', candidates);
    expect(result?.id).toBe('r2');
  });

  it('title 토큰 부분일치만으로도 매칭 성공 (shortcut 없이)', () => {
    // r1의 shortcut("/반납")과 겹치지 않는 title 단어("기본"·"안내")만으로 채택 기준 충족
    const result = matchCannedResponse('기본 안내 부탁드려요', candidates);
    expect(result?.id).toBe('r1');
  });

  it('카테고리 개념 없이 전체 후보에서 매칭 — Claude 호출 없이도 동작', () => {
    // intent 분류를 거치지 않은 상태(=카테고리 스코프 자체가 없음)에서도 정상 매칭돼야 함
    const result = matchCannedResponse('결제 방법이 궁금해요', candidates);
    expect(result?.id).toBe('p1');
  });

  it('score < 3(약한 신호만 있음)이면 미매칭 처리', () => {
    const result = matchCannedResponse('음 그게 좀 궁금한데요', candidates);
    expect(result).toBeNull();
  });

  it('관리자 등록 키워드(동의어) 매칭 — 단축키·제목과 무관한 단어도 채택', () => {
    // "고장"은 d1의 title/shortcut 어디에도 없고 오직 match_keywords에만 등록됨
    const result = matchCannedResponse('카메라가 고장났어요', candidates);
    expect(result?.id).toBe('d1');
  });

  it('등록 키워드 오타 1글자까지 허용(간단 자연어 매칭 — 순수 부분일치로는 실패하는 케이스)', () => {
    // "포인트결제"(5자) vs 고객 오타 "포인트결재"(제→재 1글자 치환) — 부분일치로는 매칭 안 되고
    // 편집거리 1 완화 매칭에서만 채택됨(4자 미만 키워드는 완화 매칭 대상에서 제외되므로 5자로 검증)
    const typoCandidates: CannedResponseForMatch[] = [
      { id: 't1', title: '결제 방법 안내', content: '내용', category: 'payment', shortcut: null, match_keywords: ['포인트결제'], usage_count: 0 },
    ];
    const result = matchCannedResponse('포인트결재 가능한가요?', typoCandidates);
    expect(result?.id).toBe('t1');
  });

  it('등록 키워드가 없는 후보는 기존 shortcut/title 신호만으로 채점됨(회귀 없음)', () => {
    const result = matchCannedResponse('반납은 어떻게 하나요', candidates);
    expect(result?.id).toBe('r1');
  });

  it('동점 시 usage_count 높은 순으로 tie-break', () => {
    const tied: CannedResponseForMatch[] = [
      { id: 'a', title: '테스트키워드 안내', content: '내용', category: 'general', shortcut: null, match_keywords: [], usage_count: 2 },
      { id: 'b', title: '테스트키워드 문의', content: '내용', category: 'general', shortcut: null, match_keywords: [], usage_count: 9 },
    ];
    const result = matchCannedResponse('테스트키워드 관련해서 문의드려요', tied);
    expect(result?.id).toBe('b');
  });

  it('후보가 없으면 null', () => {
    const result = matchCannedResponse('반납 문의', []);
    expect(result).toBeNull();
  });
});

// ── 2026-08-06 MiniSearch 교체 후 신규 케이스 ───────────────────────────────

describe('matchCannedResponse — MiniSearch fuzzy/prefix 신규 케이스', () => {
  const candidates: CannedResponseForMatch[] = [
    { id: 'r1', title: '반납 안내 기본', content: '반납은 택배 또는 직접 방문으로 가능합니다.', category: 'return', shortcut: '/반납', match_keywords: [], usage_count: 10 },
    { id: 'r2', title: '연장 요청 안내', content: '렌탈 기간 연장은 반납일 전날까지 요청 가능합니다.', category: 'return', shortcut: '/연장', match_keywords: [], usage_count: 5 },
    { id: 'p1', title: '결제 방법 안내', content: '카드·계좌이체·포인트 결합결제가 가능합니다.', category: 'payment', shortcut: '/결제', match_keywords: [], usage_count: 3 },
    { id: 'd1', title: '파손 접수 안내', content: '파손 부위 사진을 보내주시면 확인 후 절차를 안내해 드립니다.', category: 'damage', shortcut: '/파손', match_keywords: ['고장', '깨짐', '망가졌'], usage_count: 2 },
  ]

  it('prefix 매칭 — "반납" 부분 입력으로 shortcut 매칭', () => {
    // prefix=true: "반납"은 shortcut "반납"과 일치 → 기존 방식과 동일하게 작동
    const result = matchCannedResponse('반납은 언제까지 해야 하나요', candidates)
    expect(result?.id).toBe('r1')
  })

  it('MiniSearch prefix — 공백 분리 토큰으로 title 매칭 ("결제 방법")', () => {
    // "결제 방법 알려주세요": 공백 분리 → 토큰 ["결제", "방법"] → title "결제 방법 안내" 매칭
    const result = matchCannedResponse('결제 방법 알려주세요', candidates)
    expect(result?.id).toBe('p1')
  })

  it('match_keywords 조사결합어 — "고장났어요"에서 "고장" 키워드 매칭', () => {
    // 한국어 조사결합어: "고장났어요".includes("고장") → true → 서브스트링 매칭
    const result = matchCannedResponse('카메라가 고장났어요', candidates)
    expect(result?.id).toBe('d1')
  })

  it('match_keywords 5자 이상 Levenshtein — "포인트결재" → "포인트결제" 오타 매칭', () => {
    // "포인트결재"(6자) vs "포인트결제"(6자): 편집거리 1 → 6자 >= 4자 → 허용
    const kwCandidates: CannedResponseForMatch[] = [
      { id: 'kw1', title: '포인트 결제 안내', content: '포인트로 결합결제 가능합니다.', category: 'payment', shortcut: null, match_keywords: ['포인트결제'], usage_count: 0 },
    ]
    const result = matchCannedResponse('포인트결재로 가능한가요?', kwCandidates)
    expect(result?.id).toBe('kw1')
  })

  it('미매칭 케이스 — 관련 신호가 전혀 없는 메시지', () => {
    const result = matchCannedResponse('오늘 날씨 어때요?', candidates)
    expect(result).toBeNull()
  })

  it('빈 메시지 → null', () => {
    expect(matchCannedResponse('', candidates)).toBeNull()
    expect(matchCannedResponse('   ', candidates)).toBeNull()
  })
})
