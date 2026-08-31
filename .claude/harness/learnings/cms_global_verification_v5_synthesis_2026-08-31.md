# CMS 백오피스 정밀 검증 v5 — 종합 결과 (2026-08-31)

> 근거 플랜: `/Users/stevenmac/.claude/plans/clever-conjuring-fiddle.md`("CMS 백오피스 정밀 검증
> v5 — v4 폐기·전면 대체"). 이 문서는 그 플랜의 Phase 5(이미 수정됐다는 주장 재검증)와
> Phase 6(미커버 CMS 영역 확장감사)을 병렬 10개 조사 에이전트로 동시 수행한 결과다.
> **코드 수정 없음 — 순수 읽기 기반 검증**만 진행했다(TDD 게이트 미적용, 착수 승인 불필요했던
> 이유). 여기서부터의 실제 수정 착수는 Stephen의 배치 편성 승인이 필요하다(플랜 Phase 0 원칙).

---

## A. 기존 17건 OPEN CRITICAL — 재검증 결과

| ID | 요약 | 재검증 상태 | 비고 |
|---|---|---|---|
| RSV-B-C1 | 환불 RPC `success:false` 미확인 | ✅ **FIXED** | `payment/+server.ts:151-179` 3회 재시도 + 실패시 DB기록+500 반환, 테스트 통과 |
| RSV-B-C2 | 형제예약(완료·파손신고) 오집계 | ✅ **FIXED** | Migration 402 재조회 필터링, `update_reservation_status` 반환값 체크 추가 |
| RSV-B-C3 | 두발히어로 POST 멱등성 없음 | ✅ **FIXED** (경미한 잔여 리스크) | tracking_number 존재 체크로 재시도/중복클릭 차단. 단 완전 동시(race) POST 쌍은 이론상 여전히 가능(check-then-act, DB lock 없음) — 원 리포트 시나리오는 해소 |
| RSV-B-C4 | 두발히어로 취소 DB 미갱신 | ✅ **FIXED** | Migration 403 `clear_reservation_tracking_number` RPC 연동, 412 시맨틱 정리 |
| RSV-A-C1 | `/cms/reservation` 승인후 목록 stale | ✅ **FIXED**(2026-09-01 재검증) | `+page.svelte` selectedRow 동기화 `$effect`(패널 자동 close/refresh) + `applyFilters`/`setStatus`/`goPage` 전부 `selected` 파라미터 보존, 4개 시나리오(승인·반려·필터·페이지전환) 전부 확인. ⚠️ 원 감사문서가 "`/cms/rentals`에도 동일 패턴 있음"이라 언급했는데 이번 재검증은 `/cms/reservation`만 스코프였음 — `/cms/rentals` 자체는 미확인 |
| RSV-C-C1 | 승인확정 타임스탬프 오표시 | ✅ **FIXED** | `RentalDetailPanel.svelte:417-426` AND 게이팅 신규 도입 |
| RSV-C-C2 | 서명후 발송버튼 미숨김 | 🟡 **PARTIALLY FIXED** | 버튼 라벨은 고쳐졌으나 모달 자체(`viewOnly`)는 여전히 편집모드로 열림 — 단 서버단 재발송 차단(아래 RSV-C-B1)으로 실피해는 없음 |
| RSV-C-C3 | 서명후 계약편집 가드 없음(법적리스크) | ✅ **FIXED** | `content/+server.ts:86-95` PATCH 전 signed_at 체크 신규 추가 |
| NTF-C1 | `/payment/success` 게이팅 없이 알림발송 | ✅ **해소(경로자체 삭제)** | 4개 payment/success·fail 파일 전부 삭제됨, 참조 0건 |
| NTF-C2 | 번들주문 중복푸시(3곳) | ✅ **FIXED** (문서화된 4곳) / ⚠️ **신규 발견** | 문서화된 4개 발신지점은 `sendApprovalNotifications.ts`로 통일, §4 판정 이후에만 발송. **단 `checkout/confirm-mock/+server.ts`(2026-08-21 이후 클라이언트 호출 0건인 죽은 코드)에 동일 결함 패턴이 그대로 남아있음** — 재활성화 시 회귀 위험 |
| NTF-C3 | 자동승인 푸시 누락 | ✅ **FIXED** | sendApprovalNotifications 내부에서 챗+푸시 항상 세트 발송 |
| RLA-C1 | log_rental_action 호출 0건(감사공백) | ✅ **FIXED** | QR경로(`rentalQrTransition.ts`)·수동버튼경로(`+page.server.ts updateStatus`) 둘 다 호출, note로 'qr_scan'/'manual' 구분 |
| HOLD-D2-GAP | 계약발송 hold 만료정책 미확정 | ✅ **정책 확정·구현 완료** | Migration 394 GREATEST 타이머리셋 확인, D-3 예외 무손상, 테스트 4/4 통과. **Production DB 적용 여부는 코드로 확인 불가 — 직접 SQL 조회 필요** |
| RLS역할혼동 | `/cms/rentals` Realtime `is_admin()` 사용 | ✅ **구현 완료**(신규 마이그레이션, 적용 대기) | `products.md §2-8`과 동일 전례로 `is_cms_user()` 교체 — `supabase/migrations/20260901100000_408_rental_reservations_rls_cms_user_fix.sql`(§E 참고) |
| CART-C1 | 필수동의 미노출(법적리스크) | ✅ **FIXED** | `rental_consent_items` 실제 렌더링 + 개별 체크게이팅 |
| CART-C2 | CMS 대여기간 제한 미연동 | 🔴 **STILL OPEN(의도적 보류)** | 코드 주석에 "대여예약옵션 통합편집기가 아직 미포괄, 추후 재활성 고려" 명시 — 탭 자체가 disabled 처리됨 |
| CART-C3 | fee_amount UI 없음 | ✅ **FIXED(필드 자체 제거)** | UI 신설 대신 죽은 컬럼 참조를 완전 제거, `rental_shipping_settings`로 통합 |
| CART-C4 | 편도배송비 미반영(자금리스크) | ✅ **FIXED** | CMS 설정→`cartShippingFee.ts`→장바구니 합계→결제payload 전 구간 연결 확인, 테스트 31/31 통과 |

**요약(2026-09-01 최종)**: 17건 중 15건 FIXED(RSV-A-C1·RLS역할혼동 포함, 후자는 §E에서 구현
완료·적용 대기), 1건 PARTIALLY_FIXED(RSV-C-C2, 실피해 없음), 1건 STILL OPEN(CART-C2, Stephen
의도적 보류 확정) — 미재검증 항목 0건.

⚠️ **후속 확인 필요(신규 발견, 이번 라운드 스코프 밖)**: RSV-A-C1 원 감사문서가 "`/cms/rentals`
화면에도 `/cms/reservation`과 동일한 stale 패턴이 있다"고 언급했는데, 이번 재검증은
`/cms/reservation`만 대상으로 했다. `/cms/rentals` 자체의 stale 여부는 별도 확인 필요.

**Phase 5 마이그레이션 재검증(387·388·396·397·398·399, 2026-09-01)**: 6개 전부 "코드-DB 정합
확인됨" — 소비 앱코드 실존 확인, Migration 396(DROP된 레거시 결제 RPC 3종)을 여전히 호출하는
살아있는 코드도 0건(회귀 위험 없음). 유일한 캐치: `atomic_reserve_asset`의 JS 래퍼
(`src/lib/services/supabase.ts:107-121`)가 도달불가 죽은 코드로 남아있음(향후 정리 대상, 위험
아님). **6개 전부 아직 git 미커밋 + Stage/Production 미적용 상태** — "이미 수정됨"은 로컬
코드-DB 정합에만 해당, 실배포 여부는 별개로 확인 필요(§9 배포갭 사고 전례 참고).

---

## B. 신규 확장감사(Phase 6) — 미커버 영역 발견사항

### B-1. 상품(products) — option_only 신기능
**상태: CLOSED, 이슈 없음.** DB컬럼→RPC필터 4종→CMS UI→서버반영(신규+updateSection+clone 양쪽)→
조회(loadSelectedProductDetail)→NLSearch/검색페이지까지 전 계층 완전 정합 확인. 옵션상품 피커가
의도대로 이 컬럼을 검사하지 않는 것도 확인(문서 주장대로 정상).

### B-2. 프로모션(promotion) — 🔴 신규 CRITICAL 2건 발견

**① 배너: 중간슬롯 2종 완전 죽은 기능**
`mid_banner_pc`/`mid_banner_mobile` 슬롯을 CMS(`/cms/promotion/ad`)에서 등록·저장까지는 정상 동작
하지만, front(`src/routes/+page.server.ts`)는 `hero_pc`/`hero_mobile` 슬롯만 조회·렌더링한다 —
관리자가 "PC 중간 배너"를 등록해도 고객은 영구히 볼 수 없다. (`device_type` 필드도 front가 필터에
사용하지 않는 죽은 필드.)

**② 포인트: 자동적립 트리거가 프로젝트 전체에 0곳**
`point_earn_rules`(대여완료·리뷰작성·정시반납·추천인·피추천인·생일·이벤트 7종)를 CMS에서 금액·
비율·활성화까지 설정 가능하지만, 이 규칙을 읽어 실제로 포인트를 지급하는 트리거/cron/앱코드가
전무하다. `point_transactions`에 `type='earn'`을 INSERT하는 지점이 0곳(관리자 수동지급 `admin_grant`만
유일 경로) — 즉 고객은 어떤 정상 이벤트로도 자동 포인트 적립을 받지 못한다. 부수증상: `total_expired`
KPI가 항상 0(만료 처리 자체도 없음).

기타: 쿠폰 모듈(service-operations.md §14 GATE C 8개 항목)은 전수 정합 확인, 이슈 없음.

### B-3. 고객탈퇴·구독
**상태: 이슈 없음.** 탈퇴(§16) 6대 원칙(deleted_at 불변·RPC레벨 대여차단·30일자동복구·purge시점
1회 PII스크럽·휴대폰재사용차단·CMS배지) 전부 코드로 정확히 확인. 구독은 결제 재설계와 완전히
분리된 별도 스키마로 무영향, 테스트 6/6 통과. 경미한 스키마 드리프트(미추적 스텁 테이블)는 기존
알려진 이슈.

### B-4. 계정권한·코드설정·set 잔여섹션
**상태: 이슈 없음.** `/cms/accounts`, `/cms/accounts/list`(7개 액션), `/cms/codes`(20개 액션) 전수
게이트 일치 확인 — 2026-08-26에 재발했던 "일부 액션만 게이트 누락" 패턴 재발 없음. `/cms/set/signature`도
매트릭스와 일치. 단 `/cms/set/push`(브라우저 알림 설정 화면)가 실제로 존재하고 코드는 안전하게
게이트돼 있는데 security-auth.md 매트릭스 표에 행 자체가 누락돼 있음(문서 공백, 코드결함 아님).

---

## C. 부가 발견 — 후속 조치 권장 (CRITICAL 아님)

1. 계약 서명가드 신규코드(RSV-C-C1/C2/C3, RSV-C-B1 `send-chat` 재발송차단)에 대응하는 회귀테스트가
   전무함 — `contractAuthGates.test.ts`는 역할기반 403만 커버.
2. 두발히어로 POST 방어는 check-then-act(비원자적) — 진짜 동시요청 경합은 이론상 여전히 가능.
3. Migration #394(HOLD D-1 타이머), #403(clear_reservation_tracking_number)의 Production 실적용
   여부는 코드로 확인 불가 — DB 직접 조회 필요(service-operations.md §9 "코드배포≠DB적용" 사고 전례 있음).
4. `checkout/confirm-mock/+server.ts`는 현재 클라이언트 호출 0건인 죽은 코드지만 NTF-C2와 동일한
   버그 패턴을 그대로 보유 — 삭제하거나 재활성화 시 반드시 함께 수정 필요.

---

## D. 미커버 잔여 (이번 라운드 배정 안 됨)

- RSV-A-C1(목록 stale UX)
- 원 플랜 Phase 4의 나머지 항목 중 이번에 다루지 않은 세부
- Migration 위생(25개 미커밋 파일 git 반영, #394/#401/#402 Production 배포 여부) — 플랜 Phase 7 영역, 이번 라운드는 코드검증만 수행

---

*이 문서는 자동 검증 종합본이다. 원본 8개 감사문서(`cms_reservation_full_screen_audit_2026-08-31.md`
등)는 그대로 보존하고 이 문서를 최신 상태 스냅샷으로 참조할 것.*

---

## E. 후속 배치 편성 및 구현 완료 (2026-09-01)

Stephen 확인 결과에 따라 4건 중 3건 착수, 1건(CART-C2) 보류 확정. TDD(RED→GREEN) 적용, git 커밋은
미실행(Stephen 직접 실행 대기).

| 항목 | 처리 | 파일 |
|---|---|---|
| RLS 역할혼동 | ✅ 구현 완료(신규 마이그레이션, stage 적용 대기) | `supabase/migrations/20260901100000_408_rental_reservations_rls_cms_user_fix.sql` |
| 포인트 자동적립(rental_complete만) | ✅ 구현 완료 | `supabase/migrations/20260901090000_407_award_rental_complete_points.sql`, `src/lib/server/awardRentalCompletePoints.ts`, `src/lib/server/rentalQrTransition.ts`, `src/routes/cms/reservation/+page.server.ts` |
| 배너 중간슬롯 | ✅ CMS 등록화면 선택지 제거 | `src/routes/cms/promotion/ad/+page.svelte` |
| CART-C2 | ⬜ 보류(통합편집기 완성까지) | 변경 없음 |

**포인트 자동적립 구현 중 발견·동반 수정한 부가 결함 1건** (원 스코프 수행에 직접 필요했음):
- `point_transactions.ref_id`가 UUID로 선언돼 있으나 예약/주문 PK는 전부 BIGINT라 지금까지
  한 번도 실제로 채워진 적이 없었음(use_points RPC도 NULL 하드코딩) — TEXT로 전환(기존값 호환),
  이번 RPC의 멱등성(중복지급 방지) 체크에 필요했음.

**⚠️ 오판 수정(2026-09-01, Stephen 지적)**: 초안에서 `point_earn_rules.grade_multipliers` 시드
키를 `membership_grade_enum` 값(`easy|pop|crazy`)에 맞춰 "정정"하려 했으나 — 이는 잘못된
가정이었다. `easy/pop/crazy`는 **정기구독 상품 분류**이지 "고객 등급"이 아니며, 포인트 배수를
매길 만한 고객 등급 체계 자체가 아직 정의돼 있지 않다(현재 고객 분류는 §16과 무관한 별개
개념인 **인증 상태 — 일반/학생/구독** 뿐). Migration 407을 수정해 grade_multipliers 시드 데이터는
건드리지 않고, RPC도 등급 배수 조회를 하지 않도록(배수 없이 rate만 적용) 되돌렸다. 실제 고객
등급 체계가 설계되면 별도 마이그레이션으로 배수 로직을 추가할 것.

**적립 트리거 시점 관련 판단**: `point_earn_rules.event_type='rental_complete'`를 예약상태
`returned` 전이 시점(QR·수동 양쪽)에 연결했다 — `returned` 전이가 이미 이 프로젝트에서
`rental_complete`라는 이름의 채팅알림을 발송하는 지점과 동일해(rental-lifecycle.md AUTO_NOTIFY),
기존 네이밍 관례를 그대로 따른 판단이다. `completed`(관리자 별도 "완료 처리" 버튼) 시점이 더
적절하다고 판단되면 트리거 조건 한 줄(`newStatus === 'returned'` → `'completed'`)만 바꾸면 되므로
Stephen 확인 후 조정 가능.

**적용 완료(2026-09-01)**: 마이그레이션 407·408·409 전부 stage(ezyvffjvuwmtuhpxdjrw)·
production(vnbpmvxruyciuuaermyh) 양쪽 적용 및 검증 완료(권한 REVOKE/GRANT·RLS 정책·컬럼타입·
보안 어드바이저 전부 확인, ERROR/신규경고 0건). Production 사전점검에서 `rental_reservations`가
stage와 정책 구조가 달라 "관리자 전체" 정책 자체가 애초에 없었음을 확인(select/insert/update/
delete 세분화 정책만 존재) — Migration 408은 순수 추가라 충돌 없이 안전 적용, production에서는
CMS 브라우저 직접 접근을 원천 허용하는 더 근본적인 개선이었음. TDD 테스트 3파일(신규) + 관련
기존 테스트 5파일 전부 GREEN(26/26), svelte-check 신규 에러·경고 0건 확인 완료.
⚠️ **DB 적용 ≠ 앱코드 배포**(§9 사고 전례) — git 커밋·Vercel 배포 전까지는 이 기능들이
실사용자에게 아직 노출되지 않음.

---

## F. /cms/customers 고객 분류 재구성 (2026-09-01, Stephen 지시)

E번 오판 수정 후속 — "전체등급" 필터·CustomerDetailPanel "등급" 항목이 `membership_grade`
(구독상품 티어, easy/pop/crazy)를 "고객 등급"인 것처럼 노출하고 있던 것을, 실제 고객 분류 기준인
**인증 상태(일반/학생/구독)** 로 재구성했다.

**판정 기준(Stephen 확정)**:
- 구독: `membership_grade IS DISTINCT FROM 'none'` (티어 무관, 구독 중이면 전부 해당)
- 학생: `is_student = true`
- 일반: 위 둘 다 아닐 때만
- 한 고객이 학생+구독 동시 해당 가능 — 배지·필터칩 둘 다 **복수 선택/표시 허용**(우선순위 없음)

| 변경 | 파일 |
|---|---|
| `get_customer_list` RPC에 `p_classifications text[]` 다중선택 OR 필터 추가(기존 `p_membership_grade`는 하위호환 유지) | `supabase/migrations/20260901110000_409_get_customer_list_classification_filter.sql` |
| 목록 로드 — `?classification=` 콤마구분 다중값 파싱, RPC 호출 반영 | `src/routes/cms/customers/+page.server.ts` |
| 필터칩 다중선택(토글) + 목록 "등급"→"분류" 컬럼 + 행별 복수 배지 | `src/routes/cms/customers/+page.svelte` |
| 상세패널 "등급"→"분류" 항목 복수 배지 표시 | `src/lib/components/cms/CustomerDetailPanel.svelte` |

`/cms/customers/membership`(구독 플랜 관리 화면)과 CustomerDetailPanel "구독" 탭의 플랜 티어
배지(`grade-easy/pop/crazy`, tierLabel)는 손대지 않았다 — 그건 실제로 구독 티어를 다루는 별개
화면·항목이라 이번 재구성 대상이 아님(CSS 클래스만 `grade-general/student/subscriber`를
추가하고 기존 `grade-none/easy/pop/crazy`는 그대로 보존해 공존시킴).

Migration #409도 아직 미적용(stage/production 둘 다) — #407·#408과 함께 배포 필요. 이 화면은
CRITICAL TDD 도메인이 아닌 CMS UI/필터 재구성이라 별도 vitest 없이 svelte-check(신규 에러·경고
0건)로만 검증했다.
