# CMS 백오피스 정밀 검증 v6 — 종합 결과 (2026-09-06)

> 근거: 9개 트랙(A1 예약·A2 대여/이력·A3 상담채팅·A4 상품등록관리·A5 고객정보·A6 프로모션·
> A7 설정/계정·B 메뉴횡단연동·C′ DB/Production실측)을 병렬로 동시 수행한 결과를 통합한
> 종합보고서다. **코드 수정 없음 — 순수 읽기 기반 검증**만 진행했다(9개 원본 산출물은
> `.claude/harness/learnings/cms_{reservation,rentals_history,chat_consulting,products_
> spotcheck,customers,promotion_spotcheck,settings_accounts_deep,cross_menu_integration,
> db_production_reality_check}_audit_2026-09-06.md` 그대로 보존, 이 문서를 최신 스냅샷으로
> 참조할 것). 구조는 `cms_global_verification_v5_synthesis_2026-08-31.md`를 그대로 계승했다.
> 여기서부터의 실제 수정 착수는 Stephen의 배치 편성 승인이 필요하다.

---

## 요약

- 9개 트랙, 전부 read-only 정적분석 + 6개 트랙은 Supabase MCP(Stage `ezyvffjvuwmtuhpxdjrw`/
  Production `vnbpmvxruyciuuaermyh`) 실측 조회 병행.
- **CRITICAL 6건**(신규, 담당 트랙: A1·A2·A3·A6·B·C′ 각 1건) — 전부 아래 §B에 근거파일·재현조건·
  영향범위 포함해 전수 기재.
- **BOUNDARY 8건**(A1 2·A5 1·A6 2·A7 1·B 2) — §C.
- **ROUTINE 약 17건**(문서드리프트·죽은코드·성능이슈·네이밍불일치 등) — §D.
- 과거 감사(v5 등)에서 "미해결/불명확"으로 남았던 항목 재검증 결과: 대부분 FIXED 확인, 단
  **Migration #402는 v5가 "코드 로직 FIXED"로 판정했던 것과 달리 DB 자체엔 한 번도 적용된 적이
  없었다는 정반대 사실이 이번에 드러남** — 상세 §A.
- E번 섹션(오판 방지)에 "5곳 vs 8개 파일"(option_only) 등 이번 조사로 명확히 "버그 아님"이
  확정된 8개 항목을 별도로 기록했다 — 다음 세션이 재조사 낭비하지 않도록.

---

## A. 기존 재검증 결과 — 과거 감사(v5 등)에서 미해결/불명확이었던 항목

| # | 항목 | v5 시점 상태 | 이번 라운드 판정 | 담당 트랙 |
|---|---|---|---|---|
| 1 | RSV-A-C1 "`/cms/rentals`에도 동일 stale 패턴 있음" (v5가 미확인으로 명시 유보) | 미확인(스코프 밖) | 🔴 **여전히 미해소, CRITICAL로 확정**(§B-2) — `/cms/reservation`의 `else{closePanel()}` 수정이 `/cms/rentals`에는 없음 | A2 |
| 2 | RSV-C-C2 재발송 모달 편집모드 노출 | 🟡 PARTIALLY FIXED(실피해 없음) | 🟡 **동일 판정 재확인** — UI 미수정(`viewOnly={isRentalView}`에 `customerSignedAt` 미포함) 그대로이나, PATCH·send-chat 서버가드 둘 다 코드로 직접 재대조해 실피해 없음 재확인 | A1 |
| 3 | 계약서명가드(RSV-C-C1/C2/C3, RSV-C-B1) 회귀테스트 전무(v5 §C-1) | 미해결 | **여전히 0건, 미해결 유지** — 두 에러 문구 전수 grep으로 재확인 | A1 |
| 4 | CART-C2(CMS 대여기간 제한 미연동) | 🔴 STILL OPEN(의도적 보류 확정) | **상태 유지** — A2가 재현 시도 없이 기존 판정 신뢰(담당범위 밖, 재조사 안함이 지시 준수) | A2 |
| 5 | Migration #394(HOLD D-1 GREATEST 타이머) Production 실적용 여부(v5 §C-3 "코드로 확인 불가") | 불명확 | ✅ **해결 확인** — Stage·Production 양쪽 `pg_get_functiondef` 직접조회로 완전 일치 재확인(A1). 단 C′은 한 걸음 더 나아가 실제 라이브 버전이 문서가 인용한 #394보다 진화한 **#420/#421**(order-wide GREATEST)임을 발견 — 기능은 문서 주장보다 더 개선된 상태(오류 아님, 정보 갱신 필요) | A1, C′ |
| 6 | Migration #403(clear_reservation_tracking_number) Production 실적용 여부(v5 미확인) | 불명확 | ✅ **해결 확인** — Stage·Production 둘 다 함수·마이그레이션 레코드 존재 직접조회 확인 | C′ |
| 7 | RSV-B-C2(형제예약 오집계, `cancel_reservation_payment`)를 v5는 "✅ FIXED"로 판정 | ✅ FIXED(코드 로직 확인) | 🔴 **재분류: 실제로는 DB 미적용 — v5의 FIXED 판정이 코드 파일 존재만 근거로 한 반쪽 결론이었음이 드러남**(§B-6) — 마이그레이션 레코드 자체가 Stage·Production 둘 다 없고, 실제 함수는 구버전(379/384) 그대로 | C′ |
| 8 | NTF-C2 잔여 리스크 — `checkout/confirm-mock/+server.ts`가 "현재 클라이언트 호출 0건인 죽은 코드"(v5 §C-4)라 서술 | 죽은 코드로 추정 | 🔴 **재분류: 죽은 코드 아니라 활성 코드 — cart 1단계 체크아웃의 살아있는 6번째 승인알림 발신지점**(§C 목록). v5의 "죽은 코드" 전제 자체가 틀렸음 | B |
| 9 | RLS `is_admin()`→`is_cms_user()` 교체(Migration #408, v5 "구현완료·적용대기") | 구현완료·적용대기 | ✅ **Stage 적용 확인**(`pg_policy` 직접조회) — Production은 이번 라운드에서 별도 확인되지 않음, §F에 잔여로 기록 | A2 |
| 10 | RSV-B-C3(두발히어로 POST 멱등성) "경미한 잔여 리스크"(진짜 동시요청 경합 이론상 가능, v5) | 잔여 리스크 인지 | **재확인 없음 — 이번 라운드 담당 트랙 배정 안 됨**, §F로 이월 | (미배정) |
| 11 | `/cms/set/push` security-auth.md 매트릭스 미등재(v5 §B-4, 문서 공백) | 문서 공백 인지 | **재확인 없음 — 이번 라운드 A7 범위에서 다루지 않음**, §F로 이월 | (미배정) |

---

## B. 신규 발견 — CRITICAL (6건 전부)

### B-1. CS2654 전자계약서 변수 미치환 — Production 6건, 근본원인(활성 템플릿) 미수정
- **근거파일:라인**: `src/lib/utils/contract-substitution.ts:192-199`(`substituteSpreadsheetDocument`→
  `applySubstitution`, 불일치 키를 조용히 원문 유지), `src/routes/api/cms/reservations/[id]/
  contract-data/+server.ts:344-357`(실제 지원 키 목록), `contract_templates` id
  `7e635b02-ab80-4125-99a4-3784c8911d0e`("2026임대차계약서양식", 2026-09-03 최종수정 — 지금도
  깨진 상태).
- **재현조건**: 이 템플릿으로 새 계약을 발행하는 즉시 재현(수정 안 됐으므로 지금도 100% 재현
  가능). 관리자가 `{{수령일}}` 등 비표준 변수명을 셀에 직접 입력하고, 발송 전 미치환 `{{}}`
  검증 가드가 파이프라인 어디에도 없어 그대로 발송됨.
- **영향범위(실고객)**: Production `reservation_id` 12/46/47/100/102/107 총 6건. 그중
  **12/102/107은 이미 고객이 열람+서명 완료**(`contract_signings.signed_at` 존재) — 법적
  효력 있는 계약서 내용이 결함 상태로 확정됨. `{{차감포인트}}`는 이름이 정확히 일치하는데도
  6건 전부 미치환 — 원인 미규명(§F 잔여).
- **담당 트랙**: A1
- **오인점검 코멘트**: `authoring_mode` 값은 `information_schema`가 아니라 실제 로우를 직접
  SELECT로 확인했고, 결론(6건, 3건 서명완료)은 `contract_signings` 대조까지 마친 실측 근거 —
  오인 아님.

### B-2. `/cms/rentals` 목록/패널 stale — RSV-A-C1 수정이 이 화면에는 미적용
- **근거파일:라인**: `src/routes/cms/rentals/+page.svelte:65-70`(`$effect` — `if(updated)`만
  있고 `else{closePanel()}` 분기 없음. 대조: `src/routes/cms/reservation/+page.svelte:66-77`은
  이 분기가 있음).
- **재현조건**: `/cms/rentals` 기본 진입 필터가 `p_status='confirmed'` 고정(`get_rental_list`
  WHERE절 Stage에서 직접조회 확인) → 관리자가 그 화면에서 가장 흔한 정상 워크플로우(선택한
  예약을 `confirmed→shipped`로 다음단계 처리)만 수행해도 그 row가 필터에서 사라지며
  `selectedRow`가 옛 상태로 영구 고정된 채 패널이 열려있음. Realtime 구독(§D 목록 참고)도
  정상 동작이 DB로 확인돼, 다른 관리자 조작으로도 동일 재현 가능.
- **영향범위**: 패널이 stale `row.status` 기준으로 `nextStatus`/`nextLabel` 버튼을 다시 그려
  "아직 처리 전"처럼 보이는 버튼을 재노출할 가능성 — 관리자가 재클릭 시 `update_reservation_
  status`/`log_rental_action` RPC 중복 호출로 이어질 수 있음(RPC의 멱등성 자체는 이번 트랙
  스코프 밖이라 미확인, CRITICAL 격상 여지 있음).
- **담당 트랙**: A2 (보고서 자체는 "CRITICAL 후보, 최소 BOUNDARY"로 보수적으로 표기했으나,
  `/cms/reservation`에 이미 존재하는 동일 패턴 수정이 미러링되지 않았다는 확실성 높은 대조
  근거 + 이 화면의 기본 워크플로우가 매번 재현시킨다는 점에서 이 종합보고서는 CRITICAL로 확정)
- **오인점검 코멘트**: "다른 화면에 있는 수정이 이 화면에 없다"는 대조 기반 판단으로,
  `get_rental_list` WHERE절까지 Stage DB에서 직접 조회해 재현조건을 검증함 — 오인 아님.

### B-3. `/cms/chat` "대기 전환" 버튼 — 3개 정본 문서가 "없다"고 명시한 액션이 실제로 라이브
- **근거파일:라인**: `src/lib/components/chat/AdminChatPanel.svelte:1141-1147`(버튼),
  `694-705`(`handleSessionStatusChange`), `src/routes/api/chat/sessions/[id]/pending/
  +server.ts`(엔드포인트 전체 — manager+ 게이트 없음, cms_role만 있으면 partner도 실행 가능).
- **재현조건**: `/cms/chat`에서 open 세션 선택 → "대기 전환" 클릭 → `POST .../pending` →
  `set_chat_session_status` RPC로 즉시 `status='pending'` 전환.
- **문서와의 모순**: `chat.md` §3, `rental-lifecycle.md` "상담채팅 세션 상태",
  `service-operations.md` §7 — 3개 문서 전부 "대기 재진입은 오직 1시간(또는 3시간) 무응답
  자동전환뿐, 수동 대기전환 액션은 없다"고 명시. 코드 주석(`GSD-2: P1-3 상태 직접변경 버튼 —
  pending`)으로 미루어 정책 명문화 이전/무관하게 추가된 기능이 제거되지 않고 남은 것으로 추정.
- **영향범위**: 결제/예약 정합성이나 RLS 우회는 아니지만, 긴급배지(is_urgent) 신뢰성의 4중
  전제조건 중 ①(open 탭 노출)을 관리자(또는 오조작)가 즉시 무력화할 수 있음 — CS_ESCALATE
  긴급문의가 "대기" 탭으로 옮겨져 기본 뷰에서 사라질 수 있음.
- **담당 트랙**: A3
- **오인점검 코멘트**: 버튼 렌더 코드 확인 → 핸들러가 실제 엔드포인트를 호출하는지 확인 →
  그 엔드포인트가 다른 곳에서도 호출되는 죽은 코드가 아닌지 grep으로 3중 검증 후 확정 — 죽은
  코드 오인 방지 절차를 거쳤음, 오인 아님.

### B-4. 두발히어로 자동 반납완료 → 대여완료 포인트 미적립
- **근거파일:라인**: `src/lib/server/dheroAutoAdvance.ts`(`maybeAutoAdvanceOnDheroDelivered`
  전체 — `awardRentalCompletePoints` import·호출 없음). 대조:
  `supabase/migrations/20260901090000_407_award_rental_complete_points.sql` 상단 주석이
  적용 범위를 `rentalQrTransition.ts`+`cms/reservation/+page.server.ts` **두 곳으로만**
  명시적으로 한정.
- **재현조건**: 고객이 두발히어로 연동 택배로 반납 → 배송상태 5(완료) 갱신 시
  `dheroAutoAdvance.ts`가 `return_requested→returned` **자동** 전이(`/api/cron/dhero-sync`
  또는 관리자 수동 새로고침 GET에서 호출).
- **영향범위**: 이 경로로 반납이 자동완료되는 모든 예약에서 고객이 포인트를 못 받음. RPC 자체가
  멱등(예약ID 기준)이라 사후에 관리자가 재시도해도 이미 `returned`라 상태전이 버튼 자체가
  노출되지 않아(terminal 상태) **사후 보정 경로가 없음** — 조용한 손실.
- **담당 트랙**: B(메뉴횡단연동)
- **오인점검 코멘트**: Migration #407 파일의 명시적 스코프 한정 문구를 근거로 삼았고, 실제로
  grep 전수확인(`awardRentalCompletePoints` 호출부 2곳뿐)까지 마쳤음 — 추정이 아닌 직접 대조.

### B-5. `/api/cms/coupons/[id]/redemptions` — 페이지 게이트(manager+)와 API 게이트 불일치, PII 노출
- **근거파일:라인**: `src/routes/api/cms/coupons/[id]/redemptions/+server.ts:19-20`
  (`getCmsRoleForAction`이 존재 여부만 체크, `hasSettingsAccess` 없음).
- **재현조건**: `cms_role='partner'`가 `/cms/promotion/coupon` 페이지 자체는 `load()`
  게이트로 접근 불가하지만, 이 API를 브라우저 개발자도구/curl로 직접 호출하면 200 응답.
- **근본원인**: Migration 297(is_cms_user() DB체크) → Migration 298에서 "service_role
  호출은 auth.uid()가 비어 항상 실패하는 구조적 버그"를 고치며 DB 체크를 제거하고 "앱
  레벨이 이미 검증했다"는 전제로 재작성했는데, 정작 앱 레벨(`getCmsRoleForAction`)이
  `hasSettingsAccess`를 호출하지 않아 등급 검증이 완전히 사라짐.
- **영향범위**: 응답에 `userName`·`userEmail`(고객 PII), `redeemedCode`(실채번 쿠폰코드),
  `reservationId`+`cmsPath` 전량 포함 — security-auth.md가 "프로모션 쿠폰=manager 이상"으로
  명시한 정책을 정면 위반하는 권한우회.
- **담당 트랙**: A6
- **오인점검 코멘트**: `get_coupon_redemptions`의 마이그레이션 계보(297→298→299→300→301)를
  전부 직접 Read해 "가장 나중에 재정의된 버전" 기준으로 판단 — 오래된 버전 근거로 오판할
  위험을 피함.

### B-6. Migration #402(`cancel_reservation_payment_fix_cancelled_ids`) — Stage·Production 둘 다 미적용
- **근거파일:라인**: `supabase/migrations/20260831090000_402_cancel_reservation_payment_
  fix_cancelled_ids.sql`(로컬 파일은 존재, DB엔 레코드 자체가 없음). 실제 함수는
  Migration 379/384 시절 구버전(`v_actual_status` 재조회 로직 없음) 그대로 Stage·Production
  양쪽 동일하게 살아있음(`pg_get_functiondef` 직접조회 + 마이그레이션 이력 테이블
  `%402%` 검색 0건, 이중 확인).
- **재현조건**: 여러 예약이 하나의 주문으로 묶여 결제됐고 그중 일부가 이미 `completed`/
  `returned` 등 터미널 상태인 상태에서, 관리자가 `/cms/reservation` 결제정보 탭 "환불 처리"
  버튼으로 그 주문 결제를 취소.
- **영향범위**: `src/routes/api/cms/reservations/[id]/payment/+server.ts` PUT(이미 배포된
  라이브 코드)가 구버전 RPC의 잘못된 반환값을 그대로 순회해, 실제로는 취소되지 않은
  터미널 상태 예약에도 "예약이 취소되었습니다" 채팅카드·푸시 오발송 + 불필요한 두발히어로
  배송취소 API 호출 시도 — Toss 환불 자체는 정상이라 금전사고는 아니나, 고객 대상 오알림이
  **지금 이 순간도 Production에서 발생 가능**.
- **담당 트랙**: C′(DB/Production 실측)
- **오인점검 코멘트**: "마이그레이션 레코드 없음"(간접 증거)과 "함수 본문에 그 로직 없음"
  (직접 증거) 둘 다 확보 — 어느 한쪽만으로 결론내지 않음. v5는 코드 파일 존재만으로 "FIXED"
  판정했었는데, 이번엔 실제 DB 함수정의까지 대조해 v5의 판정이 틀렸음을 실측으로 뒤집음.

---

## C. 신규 발견 — BOUNDARY (8건, 중복 제거 완료)

| # | 항목 | 근거파일 | 담당 트랙 |
|---|---|---|---|
| 1 | 재발송 모달이 서명완료 후에도 편집모드로 열림(RSV-C-C2, 실피해 없음 재확인) — `viewOnly={isRentalView}`에 `customerSignedAt` 미포함 | `RentalContractViewer.svelte:310` | A1 |
| 2 | 계약서명가드(4개 서버가드) 회귀테스트 0건 | `contractAuthGates.test.ts` 전체 | A1 |
| 3 | `/api/cms/customers/[id]/inquiries`·`/coupons` — 형제 파일 `summary`는 manager+ 게이트 있는데 이 둘은 cms_role 존재만 체크(등급기준 내부 불일치, `/cms/chat` 공유설계 가능성 있어 Stephen 확인 필요) | `inquiries/+server.ts`, `coupons/+server.ts` | A5 |
| 4 | `/api/cms/chat/coupon-gift/direct-send` — sequenced 모드 쿠폰 발송 시 안내문구 누락(코드 칩이 통째로 사라진 카드만 전달, `approve_pending_coupon_gift`엔 있는 원칙이 이 sibling 경로엔 미적용) | `direct-send/+server.ts:60-105` | A6 |
| 5 | `/api/cms/segment/refresh` — manager+ 게이트 없이 모든 cms_role이 세그먼트 재계산 트리거 가능(PII노출은 없음, 위 CRITICAL 5번과 동일 클래스의 경미한 재발) | `segment/refresh/+server.ts:13-21` | A6 |
| 6 | `rental-cms-settings.md`가 참조하는 `/cms/set/rental/+page.server.ts` JSDoc이 Migration #444로 이미 폐기된 "두 플래그 상호배타" 규칙을 여전히 서술 — 5차례 뒤집힌 이력 있는 민감영역이라 재발 위험 있는 문서드리프트 | `cms/set/rental/+page.server.ts:35-39` | A7 |
| 7 | `/cms/customers` 문의내역 탭에 긴급배지(is_urgent) 정보 없음 — `/cms/chat`과 동일 세션이 두 화면에서 다른 정보량으로 노출(urgency 판정 로직 자체가 없음) | `cms/customers/chat-sessions/+server.ts:37-42`, `CustomerDetailPanel.svelte:1669-1687` | B |
| 8 | `checkout/confirm-mock/+server.ts` — 승인알림 공용헬퍼(`sendApprovalNotifications`/`resolveApprovalNotifyPlan`)를 쓰지 않고 배치알림+푸시 로직 독자 재구현, service-operations.md §9의 "5개 발신지점" 목록에 없는 6번째 활성 발신지점(현재는 기능결함 없음, 향후 배치판정 로직 변경 시 동기화 누락 위험) | `checkout/confirm-mock/+server.ts:64-95` | B |

---

## D. 신규 발견 — ROUTINE (전부 취합, 약 17건)

| # | 항목 | 담당 트랙 |
|---|---|---|
| 1 | `/cms/rentals` Realtime 구독이 `event:'*'`+필터 없음 — 전체 테이블 변경마다 `invalidateAll()`(성능/UX 관찰, B-2와 겹쳐 stale 윈도우 빈도 증가) | A2 |
| 2 | `chat.md`(3시간) vs `rental-lifecycle.md`/`service-operations.md`(1시간) — pending 자동전환 대기시간 문서 간 불일치, DB `auto_pending_inactive_sessions` 직접조회로 실제값 확정 필요 | A3 |
| 3 | security-auth.md 역할별 CMS 접근 매트릭스에 `/cms/chat`·`/cms/chat/qna` 행 미등재(코드는 안전, 문서 커버리지 공백) | A3 |
| 4 | L-1: `deleteProduct` 존재확인 없이 항상 success 반환(재확인, 여전히 미수정) | A4 |
| 5 | L-3: 재고 0개 시 부모 OFF 처리가 순차 쿼리(성능, 정합성 문제 아님) | A4 |
| 6 | L-4: `ProductDetailPanel.svelte`·`new/+page.svelte` Orphaned CSS 클래스 다수(`.btn-edit`·`.field-hint` 등) | A4 |
| 7 | L-5: `name="_unused_dmg"` 혼동 소지 네이밍 잔존 | A4 |
| 8 | L-6: `blockChildInputFocus`가 BUTTON 미차단(TabKey 필터링으로 실질 익스플로잇 경로는 없음) | A4 |
| 9 | M-4: `cloneProduct` N+1 쿼리(항목당 최대 7회, count≤20이라 요청당 최대 약 140회 순차 왕복 — Vercel 타임아웃 근접 리스크) | A4 |
| 10 | `console.error` 사용(`cms/accounts/+page.server.ts:96`) — core-rules.md는 `console.log`만 명시 금지, 참고용 | A7 |
| 11 | `checkSuperadmin()`이 `getRoleLevel` 공용헬퍼 대신 문자열 직접비교 사용(기능 차이 없음, 통일 기회) | A7 |
| 12 | `process_payment_and_create_order` 앱코드 wrapper(`supabase.ts:184-198`)가 참조 0건 완전 고아 + payment.md "삭제된 레거시 경로" 목록에서 이 RPC 자체가 누락 | A7 |
| 13 | `/cms/set/code`·`/cms/set`(bare) — GNB 어디서도 연결 안 되는 완전한 죽은 라우트(2단 리다이렉트 체인) | A7 |
| 14 | `/cms/set/admin` — 죽은 코드는 아니나 GNB 클릭마다 불필요한 리다이렉트 이중 홉 | A7 |
| 15 | `rental-cms-settings.md`가 "20개 액션"으로 서술한 `/cms/set/rental` 액션 수가 실제로는 23개(카운트 오차, 오타성) | A7 |
| 16 | `AUTO_NOTIFY` 매핑 상수가 `dheroAutoAdvance.ts`·`rentalQrTransition.ts`·`cms/reservation/+page.server.ts` 3곳에 개별 하드코딩(현재는 값 일치 확인됐으나 신규 notify_type 추가 시 3곳 수동 동기화 필요한 구조적 위험) | B |
| 17 | `release_reservation_hold` 실제 라이브 버전이 문서가 인용한 #394보다 진화한 #420/#421 — 기능은 더 개선됐으나 문서에 반영 안 됨(정보 갱신 후보) | C′ |

---

## E. "버그 아님"으로 명확히 판정된 항목 (오판 방지용 명시 기록)

1. **products.md §2-12 "5곳" vs `grep option_only` "8개 파일" 불일치** — 버그도 문서오류도
   아님. "5곳"은 고객노출 "제외 판정" 로직이 실제로 존재하는 지점 수(RPC 6종 중 그 문서
   불릿에 요약된 개수)이고, 8개 파일 중 6개는 단순 CRUD(읽기/쓰기/상속/타입선언) 지점이라
   애초에 "판정 로직"이 아니다. 마이그레이션 파일 4개(#390~393) 원문 WHERE절까지 직접
   대조 완료. (A4)
2. **L-2(권한 게이팅 비일관)** — 재분류: 버그 아님(의도된 정책). security-auth.md 매트릭스의
   "상품 관리 = partner도 세션만으로 허용"과 정확히 일치, `reassignCodeSeries`만 manager+인
   것도 products.md §2-11에 명문화된 별도 정책. (A4)
3. **CART-C2(대여기간 제한 미연동)** — 여전히 Stephen의 의도적 보류 확정 상태(재조사 없이
   기존 판정 유지, A2가 뒤집을 근거를 찾지 못함). (A2, 재확인)
4. **`coupon-gift/direct-send`·`identity-request/direct-send`가 `admin_id`를 배정하지 않음** —
   버그 아님, 의도된 설계 구분(쿠폰발급·본인증명 요청은 "CS 응대"가 아니라 별개 관리자
   액션이라는 코드 주석 근거 확인). (A3)
5. **`/cms/rental/history`의 상품 목록 `.limit(200)`** — 의도된 상한(UI에 "최대 200개 로드됨"
   안내 존재), 이슈 아님. (A2)
6. **HTML 작성모드 vs spreadsheet/flow 모드의 미치환 변수 폴백 정책 차이**(빈문자열 대체 vs
   원문 `{{}}` 유지) — 문서에 이미 암시된 의도된 차이, 보안·정합성 문제 아님. (A1)
7. **`try_confirm_reservation_order`·`find_or_create_general_chat_session`·`distribute_
   coupon`·`approve_pending_coupon_gift`(핵심 RPC 4종) + option_only 필터 RPC 6종** —
   Stage·Production md5 해시 완전 일치 확인, "코드는 배포됐는데 DB 누락" 유형이 전혀 아님
   (B-6과 반대 사례로 대조 기록해둘 가치 있음). (C′)
8. **`cms_menu_permissions` EC-5(자기 자신 대상 메뉴권한 변경 self-service 차단)** — 문서에
   없는 초과 구현이지만 보안 강화 방향이라 문제 아님, 문서 갱신 후보로만 기록. (A7)

---

## F. 미커버 잔여 (이번 9개 트랙도 다루지 못한 영역)

- **RSV-B-C3**(두발히어로 POST 진짜 동시요청 경합, check-then-act 비원자적) — v5가 "경미한
  잔여 리스크"로 남긴 이후 이번 라운드 담당 트랙 배정 안 됨.
- **`/cms/set/push`** — security-auth.md 매트릭스 미등재(v5 §B-4 문서 공백) 이번 라운드
  미재확인.
- **Migration 25개 미커밋 파일 git 반영 여부** — v5 §D부터 이어지는 잔여, 이번 라운드도
  코드검증(적용여부)만 하고 git 위생은 다루지 않음.
- **`{{차감포인트}}`**(이름이 정확히 일치하는데도 CS2654 6건 전부 미치환) — 원인 미규명,
  A1이 후속 세션 재조사 권장으로 명시.
- **pending 자동전환 정확 임계값**(3시간 vs 1시간) — DB `auto_pending_inactive_sessions`
  함수 정의를 이번 라운드에서 직접 조회하지 않음(A3이 시간상 미실시로 명시).
- **Migration #408(RLS is_cms_user) Production 적용 여부** — A2는 Stage만 확인, Production은
  이번 라운드에서 별도로 조회되지 않음.
- **`restore_withdrawn_account` 로그인 시 CMS 배지의 실시간 반영 여부** — RPC 로직(5개 컬럼
  원복)은 마이그레이션 파일로 확인됐으나, 실제 로그인 이벤트 → CMS 화면 반영 타이밍은 정적
  코드 추적만으로 100% 검증 불가(B가 명시).
- **Production `contracts.html_document` 컬럼 부재**(Migration 447 미적용) — HTML 작성모드
  신규기능(2026-09-04 도입)이 Production에서 시도되면 즉시 에러 가능성, Stephen 확인 필요로
  A1이 남김(§9 "코드배포≠DB적용" 사고 패턴과 동일 유형이나 신규기능이라 CRITICAL 단정 보류).
- **`contract.md`의 `contracts.signing_sent_at` 컬럼** — Stage·Production 둘 다 실존하지
  않는 스테일 문서 서술(실제로는 `contract_signings.sent_at`), 코드 동작에는 영향 없어 문서
  정정 후보로만 A1이 기록.

---

## G. 후속 배치 제안 (우선순위 순, 착수는 이 계획 범위 밖 — 제안만)

> AGENTS.md 기준 TDD 강제 도메인(결제·예약·보안·크레이지스코어 키워드) 여부로 분류.

| 순위 | 항목 | 등급 | 도메인 분류 | 분류 근거 |
|---|---|---|---|---|
| 1 | **B-5: 쿠폰 사용내역 API 권한우회**(`/api/cms/coupons/[id]/redemptions`) | CRITICAL | **TDD 강제** | 보안(권한우회)+PII 노출 — "보안" 키워드 정면 해당. 수정 자체는 `hasSettingsAccess()` 한 줄이나, 회귀방지 테스트 신설이 TDD 원칙상 필수 |
| 2 | **B-6: Migration #402 미적용**(`cancel_reservation_payment`) | CRITICAL | **TDD 강제** | 결제(환불) 도메인 — RPC는 이미 작성돼 있으니 Stage 적용→검증→Production 적용의 표준 순서만 필요하나, "결제" 키워드 도메인이라 적용 전후 회귀테스트 필수 |
| 3 | **B-1: CS2654 계약변수 미치환**(활성 템플릿 수정 + 발송전 검증가드) | CRITICAL | **TDD 강제**(경계) | 직접적으로는 "결제/예약/보안" 키워드는 아니나, 법적효력 있는 계약서(예약승인 §9 게이팅과 직결)이자 이미 실고객 서명까지 발생한 사안 — 신규 검증가드(발송 전 `{{}}` 잔존 체크)는 로직 신설이라 TDD 권장. 템플릿 문구 자체 수정(데이터 정정)은 TDD 대상 아님, 별도 처리 가능 |
| 4 | **B-4: 두발히어로 자동반납 포인트 미적립**(`dheroAutoAdvance.ts`에 `awardRentalCompletePoints` 추가) | CRITICAL | **TDD 권장** | "결제/보안"에 직접 해당하진 않으나 포인트=화폐성 자산 적립 로직이고, 기존 두 경로(QR/수동)가 이미 TDD로 구현된 동일 함수를 재사용하는 확장이라 동일 기준(TDD) 적용이 일관성 있음 |
| 5 | **B-2: `/cms/rentals` stale 패널**(`else{closePanel()}` 1줄 추가) | CRITICAL | **GSD** | 순수 CMS UI 상태동기화 버그, 결제/예약 데이터 자체를 변경하지 않음(단, 수정 후 RPC 중복호출 가능성 부분은 A1/RentalDetailPanel 담당자가 별도로 RPC 멱등성 확인 권장) |
| 6 | **B-3: `/cms/chat` "대기 전환" 버튼**(제거 또는 정책 재검토+문서 3건 동기화) | CRITICAL | **GSD** | 상담채팅 UX/정책 정합성 사안, 결제·예약·보안 키워드 미해당. 단 Stephen의 정책 재확인(제거 vs 공식 허용)이 선행돼야 착수 가능 |

**착수 순서 권고**: 1·2번(보안·결제, 실피해 진행형)을 최우선으로, 이어서 3번(이미 발생한
법적리스크 확산 차단), 4번(조용한 손실 지속 방지), 5·6번(UX/정책, 상대적으로 낮은 실피해)
순으로 배치 편성 권장. 6번은 Stephen의 정책 방향 확인이 코드 작업보다 선행돼야 한다.

---

*이 문서는 9개 트랙 자동 검증 종합본이다. 원본 9개 감사문서는 그대로 보존하고 이 문서를
2026-09-06 시점 최신 스냅샷으로 참조할 것. 실제 수정 착수는 Stephen의 배치 편성 승인 이후
별도 세션에서 진행한다.*
