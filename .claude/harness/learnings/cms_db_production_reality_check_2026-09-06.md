# CMS DB/Production 실측 검증 (트랙 C′) — 2026-09-06

## 요약 (3줄)

- Migration #394(GREATEST 타이머)·#401·#403·`process_payment_and_create_order`·옵션상품(option_only) RPC 6종·계약서명/쿠폰선물/연체료 3개 기능의 의존 RPC 4종은 전부 **Stage·Production 양쪽 다 실제 적용 확인**(함수정의 직접조회, md5 해시까지 완전 동일).
- 🔴 **CRITICAL 신규 발견**: **Migration #402(`cancel_reservation_payment` 알림대상 정확화, RSV-B-C2)가 Stage·Production 둘 다 적용되지 않았다** — 마이그레이션 이력 테이블에 "402" 레코드 자체가 없고, 실제 함수정의를 직접 조회한 결과 Migration 379/384 시절의 구버전(무조건 `v_cancelled_ids`에 추가하는 로직) 그대로 살아있음을 확인. 이 RPC는 CMS 환불처리 화면(`/api/cms/reservations/[id]/payment` PUT, 코드는 이미 배포됨)이 실사용 중이라 지금 이 순간에도 버그가 라이브 상태다.
- release_reservation_hold는 문서(rental-lifecycle.md/service-operations.md)가 언급한 Migration #394보다 더 최신인 #420/#421(order-wide GREATEST + 배치알림)까지 이미 적용돼 있었다 — GREATEST 핵심 로직 자체는 문서 서술과 일치하나 실제 함수 버전은 그보다 앞서있다는 점만 부기.

---

## 1. Migration #394 (release_reservation_hold D-1 GREATEST 타이머)

**조회 방법**: `pg_get_functiondef()`로 `public.release_reservation_hold` 함수정의를 Stage(ezyvffjvuwmtuhpxdjrw)·Production(vnbpmvxruyciuuaermyh) 양쪽에서 직접 조회.

**실제 결과**: 두 DB의 함수정의가 **완전히 동일**(텍스트 100% 일치). 내용은 다음을 포함:
- `WHERE rr.status = 'hold' AND rr.payment_confirmed_at IS NULL AND GREATEST(rr.created_at, COALESCE((SELECT MAX(cs.sent_at) ... WHERE cs.sent_at IS NOT NULL AND c.reservation_id IN (... 같은 주문의 모든 reservation_id ...)), rr.created_at)) < NOW() - INTERVAL '30 minutes'`
- 계약서명 `sent_at` 존재 시 그 시점 기준으로 타이머가 리셋되는 GREATEST 로직이 실제로 존재함 — 문서 서술과 일치.
- 단, 이 버전은 Migration #394(단일 예약 기준)보다 진화한 형태로, `order_items`를 JOIN해 **같은 주문(order)에 묶인 모든 reservation의 계약 발송 이력**을 함께 고려하고, 만료 처리 후 알림도 `send_rental_chat_notification_batch`(다건)/`send_rental_chat_notification`(단건)으로 주문 단위로 분기한다. 이는 마이그레이션 목록에 있는 `420_release_reservation_hold_order_group_notify`·`421_release_reservation_hold_order_wide_contract_timer`(Stage: 20260902092221/20260902092238, Production: 20260902092221/20260902092238)가 반영된 최신 버전이다.

**Stage/Production 상태**: 둘 다 동일 최신 버전 적용 완료. 문서(rental-lifecycle.md §"HOLD D-1 타이머 리셋 정책", service-operations.md §10)의 "GREATEST 존재 확인" 주장은 **사실**이나, 실제 라이브 버전은 문서가 인용한 #394보다 한 단계 더 진화된 상태라는 점은 문서에 반영돼 있지 않음(오류는 아니고 정보 갱신 여지).

**결론**: ✅ 정합 — 재확인 완료. 등급: 해당 없음(정상).

---

## 2. Migration #401 / #402 / #403 Production 실적용 여부

**사전 파일 확인** (`supabase/migrations/` 로컬 파일 내용 직접 Read):
- `20260831080000_401_payment_transactions_refund_failure.sql` — `payment_transactions`에 `refund_failed_at TIMESTAMPTZ`, `refund_failure_reason TEXT` 컬럼 추가(ADD COLUMN IF NOT EXISTS).
- `20260831090000_402_cancel_reservation_payment_fix_cancelled_ids.sql` — `cancel_reservation_payment` RPC 재정의. 기존(Migration 384)엔 `PERFORM update_reservation_status(v_rid,'cancelled')` 호출 후 반환값을 버리고 무조건 `v_cancelled_ids`에 추가했는데, 이를 "PERFORM 후 실제 status를 재조회해 정말 'cancelled'로 바뀐 경우만 포함"하도록 수정(RSV-B-C2).
- `20260831100000_403_clear_reservation_tracking_number.sql` — 두발히어로 배송취소 성공 후 `tracking_number`를 NULL로 초기화하는 신규 RPC(`clear_reservation_tracking_number`).

**조회 방법**:
1. `list_migrations` — 마이그레이션 이력 테이블 전수 조회(양쪽 프로젝트).
2. `SELECT version,name FROM supabase_migrations.schema_migrations WHERE name LIKE '%402%' OR name LIKE '%cancel_reservation_payment%'` — 402 레코드 존재 여부 직접 확인.
3. `pg_get_functiondef()`로 `cancel_reservation_payment` 실제 함수 본문을 양쪽에서 조회해 RSV-B-C2 수정(`v_actual_status` 재조회 로직)이 실제로 반영됐는지 코드 레벨로 대조.
4. `information_schema.columns`로 `payment_transactions.refund_failed_at`/`refund_failure_reason` 존재 여부 확인(양쪽).
5. `pg_proc`로 `clear_reservation_tracking_number` 함수 존재 여부 확인(양쪽).

**실제 결과**:
| 항목 | Stage(ezyvffjvuwmtuhpxdjrw) | Production(vnbpmvxruyciuuaermyh) |
|---|---|---|
| #401 컬럼(`refund_failed_at`,`refund_failure_reason`) | ✅ 존재 | ✅ 존재 |
| #401 마이그레이션 레코드 | ✅ `401_payment_transactions_refund_failure` 존재 | ✅ 동일 |
| #402 마이그레이션 레코드 | ❌ **없음**(`%402%` 검색 결과 0건) | ❌ **없음**(0건) |
| #402 실제 함수 로직(`v_actual_status` 재조회) | ❌ **없음** — Migration 379/384 시절 구버전 그대로(`PERFORM` 후 무조건 `v_cancelled_ids := v_cancelled_ids \|\| v_rid` — 재조회 코드 자체가 없음) | ❌ **없음** — Stage와 완전히 동일한 구버전 |
| #403 함수(`clear_reservation_tracking_number`) | ✅ 존재 | ✅ 존재 |
| #403 마이그레이션 레코드 | ✅ `403_clear_reservation_tracking_number` 존재 | ✅ 동일 |

**#402 미적용의 실질적 영향(코드 추적으로 확인)**:
`src/routes/api/cms/reservations/[id]/payment/+server.ts`(이미 git 배포된 라이브 코드) PUT 핸들러가 `cancel_reservation_payment` RPC의 `cancelled_reservation_ids` 반환값을 그대로 순회하며:
- `send_rental_chat_notification(..., 'reservation_cancelled')` 채팅 알림 발송
- `sendReservationLifecyclePush(..., 'reservation_cancelled')` 브라우저 푸시 발송
- `tracking_number`가 있으면 두발히어로 배송취소 API 호출 시도

구버전 RPC는 같은 주문(order)에 묶인 예약들 중 **이미 completed/returned 등 터미널 상태라 실제로 cancelled 전환이 안 된 예약까지도** 무조건 `cancelled_reservation_ids`에 포함시킨다. 즉 관리자가 여러 상품이 묶인 주문의 결제를 환불 처리하면, 이미 종료된(반납완료) 예약 건에 대해서도 "예약이 취소되었습니다" 채팅카드·푸시가 고객에게 발송되고, 불필요한 두발히어로 취소 API 호출이 시도될 수 있다 — 실제 결제/환불 자체(Toss 취소, `payment_transactions` 갱신)는 정상 동작하므로 금전 사고는 아니지만, 고객에게 혼란을 주는 오알림이 지금 이 순간 Production에서도 발생 가능한 상태다.

**결론**: 🔴 **CRITICAL** — #402는 "코드 배포됐는데 DB 마이그레이션 누락"의 전형적 사례(service-operations.md §9 선례와 동일 클래스). Stage조차 적용 안 됐다는 점에서 "Production만 지연"이 아니라 **이 마이그레이션 자체가 어느 환경에도 한 번도 적용된 적이 없다**(파일은 작성됐으나 배포 누락).

---

## 3. 계약서명(sign)·쿠폰선물(coupon-gift)·연체료안내(late-fee) 의존 RPC

**대상 파일**(코드 확인):
- `src/routes/api/contracts/[token]/sign/+server.ts` → `try_confirm_reservation_order`, `update_reservation_status`, `find_or_create_general_chat_session` 호출
- `src/routes/api/cms/chat/coupon-gift/direct-send/+server.ts` → `distribute_coupon` 호출
- `src/routes/api/cms/chat/coupon-gift/[messageId]/approve/+server.ts` → `approve_pending_coupon_gift` 호출
- `src/routes/api/checkout/late-fee/[id]/pay-mock/+server.ts` → `find_or_create_general_chat_session` 호출

**조회 방법**: 4개 RPC(+`update_reservation_status`는 오래된 함수라 제외, 나머지 핵심 4종) 전부에 대해 Stage·Production 양쪽에서 `pg_get_functiondef()`의 md5 해시를 비교.

**실제 결과**:
| RPC | Stage md5 | Production md5 | 일치 여부 |
|---|---|---|---|
| `try_confirm_reservation_order` | e32bc0e... | e32bc0e... | ✅ 완전 일치 |
| `find_or_create_general_chat_session` | bde64f9... | bde64f9... | ✅ 완전 일치 |
| `distribute_coupon` | 74a9ad5... | 74a9ad5... | ✅ 완전 일치 |
| `approve_pending_coupon_gift` | 0a12f56... | 0a12f56... | ✅ 완전 일치 |

`try_confirm_reservation_order`의 실제 본문도 직접 확인 — Migration #398("no payment side effect" 수정)이 의도한 대로, 직접 UPDATE 없이 `try_confirm_reservation()`을 예약별로 호출하고 실제로 confirm된 것만 배열에 담아 반환하는 구조로 돼 있음(부작용 없는 순수 순회).

**결론**: ✅ 정합 — 3개 기능(sign/coupon-gift/late-fee)이 의존하는 DB 객체는 Stage·Production 완전히 동일 버전으로 적용돼 있다. "코드는 커밋됐는데 DB가 누락"된 정황 없음.

---

## 4. `process_payment_and_create_order` RPC 실존 여부

**조회 방법**: `pg_proc`에서 `proname='process_payment_and_create_order'` 직접 검색(양쪽).

**실제 결과**: Stage·Production 둘 다 **존재 확인**(`{"proname":"process_payment_and_create_order"}` 반환).

**결론**: ✅ 존재 — 양쪽 동일. (참고: 이 함수명은 `database.ts`/`supabase.ts`에도 타입/참조가 있어 grep으로도 나왔으나, 이번엔 타입 파일을 신뢰하지 않고 `pg_proc` 직접 조회로 실존을 별도 검증함 — misidentifications.md의 "enum/RPC는 database.ts 대신 information_schema/pg_proc 직접조회" 교훈 적용.)

---

## 5. 옵션 상품 전용(`option_only`) 필터 RPC 6종 (Migration #390~393)

**대상**: `search_products`, `get_products_by_ids`, `get_home_theme_groups_with_products`, `get_home_theme_groups_admin`, `get_hype_pack_theme_groups_with_products`, `get_hype_pack_theme_groups_admin`.

**조회 방법**:
1. md5 해시 비교(양쪽) — 위 3번 항목과 같은 쿼리에 포함해 동시 조회.
2. `pg_get_functiondef() ILIKE '%option_only%'`로 실제 본문에 필터 조건이 존재하는지 Production에서 직접 확인(Stage는 md5 해시 완전 일치로 동일 결론 대체).

**실제 결과**: 6개 함수 전부 Stage·Production **md5 해시 완전 일치** + Production 6개 전부 `option_only` 조건 포함 확인(`has_option_only_filter: true` 전부).

**결론**: ✅ 정합 — Migration #389~393(products.md §2-12) 전부 양쪽 적용 완료, 코드 내용까지 동일.

---

## 신규 발견 (등급 포함)

### 🔴 CRITICAL — Migration #402(`cancel_reservation_payment_fix_cancelled_ids`) 미적용
- **위치**: `supabase/migrations/20260831090000_402_cancel_reservation_payment_fix_cancelled_ids.sql`(로컬 파일은 존재) / DB에는 Stage·Production 둘 다 이 마이그레이션 레코드 자체가 없음.
- **재현조건**: 여러 예약(reservation)이 하나의 주문(order_items로 묶임)으로 결제됐고, 그중 일부는 이미 `completed`/`returned` 등 터미널 상태로 대여가 끝난 상태에서, 관리자가 CMS `/cms/reservation` 결제정보 탭 "환불 처리" 버튼으로 그 주문 결제를 취소하는 경우.
- **영향범위**: `src/routes/api/cms/reservations/[id]/payment/+server.ts` PUT 핸들러(라이브 배포 코드) — 터미널 상태라 실제로는 `cancelled`로 전환되지 않은 예약에도 "예약이 취소되었습니다" 채팅카드/푸시 오발송 + 불필요한 두발히어로 배송취소 API 호출 시도. Toss 환불(금전)·`payment_transactions` 갱신 자체는 정상이라 금전 사고는 아니지만, 고객 대상 오알림이 실사용 중 발생 가능.
- **권장 조치**: Migration #402를 Stage에 먼저 적용 → 검증 후 Production 적용(프로젝트 표준 순서). 코드 변경은 이미 완료돼 있으므로(RPC 정의 파일 존재) 실제 `apply_migration` 실행만 필요.

### ROUTINE — release_reservation_hold 문서-실물 버전 차이(오류 아님, 정보성)
- rental-lifecycle.md/service-operations.md는 "Migration #394 GREATEST 적용 확인"으로 서술하나, 실제 라이브 함수는 그보다 진화한 Migration #420/#421(order-wide 버전)이 적용돼 있음. 기능적으로는 문서가 주장하는 GREATEST 로직을 포함하고 오히려 더 개선된 상태라 실사용 리스크는 없음 — 향후 문서 갱신 시 참고용으로만 기록.

---

## 자체 오인점검

- **enum/RPC 비교 시 database.ts 대신 information_schema/pg_proc 직접조회 원칙** — `process_payment_and_create_order`는 코드에서 grep으로 참조를 먼저 확인했으나, 최종 판정은 반드시 `pg_proc` 직접 조회 결과로만 내렸다(타입 파일 참조는 "어디서 쓰이는지" 파악용으로만 사용, 존재판정 근거로 사용 안 함). `cancel_reservation_payment`의 "적용 여부" 판정도 마이그레이션 이력 테이블 레코드 유무만으로 끝내지 않고, 반드시 `pg_get_functiondef()`로 실제 함수 본문을 읽어 RSV-B-C2 수정 코드(`v_actual_status` 재조회)의 존재 여부까지 코드 레벨로 대조했다 — "마이그레이션 레코드가 없다"는 간접 증거와 "함수 본문에 그 로직이 없다"는 직접 증거를 모두 확보해 결론의 이중 근거를 마련함.
- **과거 마이그레이션 인용 시 파일을 직접 열어 확인** — Migration #394/#401/#402/#403 전부 로컬 SQL 파일을 Read로 실제 열어 그 안의 로직·컬럼명·함수시그니처를 확인한 뒤에만 DB 조회 쿼리를 작성했다(내용을 기억이나 추정으로 재구성하지 않음).
- **결론이 "문서와 일치"로 나온 항목(#394, #401, #403, 4종 RPC, 6종 option_only RPC)도 전부 실제 SQL 실행 결과를 근거로 삼았다** — "문서에 이미 적혀있으니 맞을 것"이라는 확신 편향을 배제하기 위해 5개 항목 전부 개별적으로 직접 조회했고, 그 결과 실제로 하나(#402)가 문서/코드의 암묵적 전제와 어긋남을 발견했다.
- 본 세션은 읽기전용 SELECT/조회(`execute_sql`의 SELECT 구문, `list_migrations`)만 사용했으며 INSERT/UPDATE/DELETE/DDL·`apply_migration`은 전혀 실행하지 않았다.
