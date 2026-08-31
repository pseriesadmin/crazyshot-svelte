# TASK.md 아카이브 — unknown-date
# 명시적으로 'DONE'/'QA 검수 완료'로 라벨링됐던 항목만 보관 — 헤더 텍스트로 완료 여부를 추측 판정하지 않음

## QA 검수 이력

- 1차 QA(`@sp3-qa-agent`, GATE C→E): 9개 확정 사양 전부 충족, TDD 4/4 통과, stage DB 크로스체크
  완료 → GATE E 통과 판정. 검수 중 QA 에이전트가 `git stash`를 실행해 저장소에 무관한 옛
  stash와 충돌이 발생했으나(이번 세션 커밋과는 무관), harness 안전장치가 `git reset` 등 되돌리기
  명령을 자동 차단했고 Stephen이 `git reset --hard HEAD` + `git stash drop`으로 직접 정리 완료 —
  유실된 작업 없음(git log로 재확인)
- 2차 QA 대상(예정): `4f9aab5` 버그 수정 커밋은 1차 QA 이후에 이뤄져 아직 QA 검수 전 — 재검수
  필요

---


## DONE
- S0: 환경 설정 + DB 스키마 + RPC 함수 9개
- S1-M1: Products 모듈 (리스트 + 상세)
- S1-M2: Reservation Flow (TDD RED/GREEN/REFACTOR)
- S1-M2.5: Cart Dev Route (장바구니 UI 개발) — 10개 컴포넌트/파일
- PRD.1.7 T1: DB Migration (chat_sessions / chat_messages / chat_intent_logs / cs_records + RLS + Realtime)
- PRD.1.7 T2: 타입 정의 (src/lib/types/chat.ts)
- PRD.1.7 T3: 서비스 레이어 (src/lib/services/chatService.ts)
- PRD.1.7 T4: 스토어 (src/lib/stores/chat.svelte.ts — class 패턴)
- PRD.1.7 T5: API 라우트 5개 (session/message[AI분류]/sessions/action-card/close)
- PRD.1.7 T6: UI 컴포넌트 5개 (ChatHeader / MessageBubble / ActionCard / MessageList / ChatInput)
- PRD.1.7 T7: 컨테이너 3개 (ChatWindow / ChatBottomSheet / FloatingChatButton)
- PRD.1.7 T8: +layout.svelte fab-bar 삽입
- PRD.1.7 T8b: fab-bar 충돌 해결 — checkout/products[id] 직접 삽입 (장바구니→검색→채팅)
- PRD.1.7 T10: 고객 채팅 라우트 `/chat` 구축 (풀스크린 ChatWindow + 딥링크 파라미터)
- PRD.1.7 T11: DB 마이그레이션 적용 (4테이블 RLS), API/Realtime 코드 검증 완료 (AI키·Realtime활성화는 Stephen 액션)
- CMS 프로모션 Phase 1 완료 (T1 GNB/T2 DB #45~#51/T3 홍보/T4 쿠폰/T5 포인트/T6 홈배너)
- CMS 프로모션 Phase 2 완료 (DB #52~#55/behaviorTracker/세그먼트 페이지/API)


## DONE

---


## DONE

---


## DONE

---


## DONE — 🟡 BOUNDARY: 예약신청 본인증명 흐름 4단계 재확인 + 등록완료 자동복귀 결함 수정
(2026-08-26, 이 세션)

**1차 요청**: `/products/creator-set01-qa-stage` 예약신청 시 4단계 로직(①로그인게이트
②본인증명 미등록 안내토스트→`/account/profile?tab=profile` 랜딩 ③본인증명 등록 UI(콤보
선택+드래그/파일선택 업로더+1~5개 파일+등록하기 버튼 활성화) ④등록완료 시 완료토스트+이전
상품상세화면 자동복귀) 구현 상태 재확인 요청.

**재확인 결과**:
- ①②는 직전 세션에서 이미 구현·QA 통과된 그대로 코드상 정상 존재 — 변경 없음.
- ③은 **다른 동시 진행 세션**이 이미 완전히 구현해둔 상태였음(Migration 345/346/349,
  `/api/profile/upload-doc` `MAX_IDENTITY_FILES=5` + 배열 저장, `ProfileTabContent`의
  `identityFiles`(배열)·`ondragover`/`ondragleave`/`ondrop`·파일카운트 등) — 요청 스펙과
  정확히 일치, 코드 확인만 하고 손대지 않음.
- ④는 실제로 누락돼 있었음 — `uploadIdentityDoc()` 성공 시 완료 토스트만 뜨고 화면 이동
  로직이 전혀 없어 개인정보 화면에 계속 남아있는 상태였음.

**1차 수정**(1차 요청 대응): `history.length > 1 ? history.back() : goto('/account')`
추가(`ProductHero.svelte`의 `goBack()` 관례와 동일 패턴).

**2차 요청**(Stephen이 1차 수정을 3건 재수정 지시):
1. 암묵적 브라우저 히스토리(`history.back()`)가 아니라 "이전 상품 경로값을 명시적으로
   보유"하는 구조로 교체.
2. 완료 토스트 문구를 정확히 "본인증명 등록이 확인되었습니다."로 지정.
3. 토스트 호출 조건 — "등록하기" 실행 직후 "정합됨" 신호를 확인한 뒤에만 토스트를 부르는
   구조일 것.

**2차 수정**:
- `src/routes/products/[id]/+page.svelte` — 본인증명 미등록 안내 토스트의 '확인' onClick에서
  `window.location.pathname + window.location.search`를 `returnTo` 쿼리파라미터로 인코딩해
  `/account/profile?tab=profile&returnTo=...`로 이동(기존엔 `tab`만 전달).
- `src/lib/components/members/profile/ProfileTabContent.svelte` — `$app/stores`의 `page`
  스토어로 `returnTo`를 읽음(prop 스레딩 없이 렌더트리 어디서든 `$page` 접근 가능한 SvelteKit
  특성 활용 — PC 임베드 모드(`/account?tab=profile&returnTo=...`)와 모바일 전용 라우트
  (`/account/profile?tab=profile&returnTo=...`) 양쪽 다 기존 리다이렉트가 쿼리스트링 전체를
  그대로 들고 가므로 추가 배선 없이 동일 동작). "정합됨" 신호는 업로드 API 응답의 `ok:true`
  만으로 판정하지 않고, 실제 반환된 `docUrls.length`가 제출한 `identityFiles.length`와
  정확히 일치할 때만 `isConsistent`로 판정 — 불일치 시 완료 토스트·화면이동 모두 생략, 에러
  메시지만 표시. 정합 확인 후에야 `csToast.success('본인증명 등록이 확인되었습니다.')` 호출.
  복귀 우선순위: `returnTo`(오픈리다이렉트 방지 — `/`로 시작 + `//` 아님 검증) → 없으면
  `history.back()` → 그마저 없으면 `/account`.

**검증**: `npx svelte-check` — 신규 에러 0건(기존 무관 에러 1건만 잔존).

**GATE 등급**: 🟡 BOUNDARY — 회원 화면 내비게이션·토스트 로직 수정, DB/RPC 변경 없음.

---


