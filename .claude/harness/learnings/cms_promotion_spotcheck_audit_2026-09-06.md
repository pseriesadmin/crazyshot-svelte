# CMS 프로모션(`/cms/promotion/*`) 정밀 재검증 — A6 트랙 (2026-09-06)

**요약(3줄)**: 7개 서브라우트(ad·coupon·point·segment·rules·analytics·content) 전부 `load()` 단계에서
`hasSettingsAccess`(manager+) 게이트가 정상 적용돼 있고, 쿠폰 지연채번(Lazy Sequencing) 원칙은
`use_coupon`/`cms_create_coupon`/`distribute_coupon`/`approve_pending_coupon_gift` 전 계보(migration
262→301)에 걸쳐 문서(§14) 그대로 정확히 구현돼 있음을 확인. 다만 `/cms/promotion/coupon` 페이지가
호출하는 백엔드 API 1곳(`/api/cms/coupons/[id]/redemptions`)에서 **페이지 레벨 권한(manager+)과
API 레벨 권한(모든 cms_role)이 불일치하는 CRITICAL 권한우회 결함**을 신규 발견 — partner 등급이
API를 직접 호출하면 고객 PII(이름·이메일)와 쿠폰 사용 이력을 그대로 조회 가능. 그 외 부가발견 2건(BOUNDARY).

---

## 1. 중점사항 검증 결과

### ① 쿠폰 지연채번(Lazy Sequencing) 원칙 준수 — ✅ 정상
- `distribute_coupon`(Migration 291) — `redeemed_code`/`coupon_code_sequences` 어디에도 손대지 않음. 배포 시점 순번 무소비 확인.
- `cms_create_coupon`(Migration 293, 구시그니처는 294로 DROP 완료) — sequenced 모드에서 `p_code=NULL` 저장, manual 모드는 `p_code` 필수. 서버 액션(`src/routes/cms/promotion/coupon/+page.server.ts:296-306`)도 동일 분기로 payload 구성.
- `use_coupon`(계보: 267→291→293→296→297→348, 최신 348) — `generate_user_coupon_redeemed_code()`를 **모든 자격조건 검증 통과 후, 실제 소진(UPDATE) 처리 직후**에만 호출. 순번 소비는 오직 이 지점 하나뿐임을 전 계보에서 확인(중간에 재정의된 5개 버전 모두 이 순서 불변).
- `generate_user_coupon_redeemed_code`(Migration 292) — 멱등성(이미 채번된 경우 즉시 반환) + `FOR UPDATE` 비관적 잠금 + `max_sequence` 초과 시 카운터 롤백 후 예외, 문서(§14) 서술과 정확히 일치.

### ② sequenced 쿠폰 등록 시 code=NULL / code_series 채움 — ✅ 정상
- `+page.server.ts` `createCoupon` 액션(라인 296-306): `codeMode==='sequenced'`일 때 `p_code: null`, `p_code_series: code_series` — 문서 원칙과 일치. 반대 조합(sequenced인데 code 채워짐, manual인데 code_series만 채워짐)은 클라이언트 사전검증(라인 296-301) + DB CHECK 제약(`coupons_code_mode_chk`, Migration 291)으로 이중 방어.

### ③ `approve_pending_coupon_gift` sequenced 코드 미노출 — ✅ 정상 (단, 유사 경로 1곳 누락 — 아래 부가발견 참고)
- Migration 293 B-6: `code_mode='sequenced'`면 `v_display_code := '쿠폰이 발급되었습니다. 결제 시 자동으로 적용됩니다.'`로 대체, manual만 실제 코드 노출. 최신 정의(293 이후 재정의 없음, 계보 확인 완료)까지 유지됨.

### ④ 7개 서브라우트 전부 manager+ 게이트 — ✅ 정상
`load()` 레벨 `hasSettingsAccess(cmsRole) → redirect(303, '/cms?notice=access_denied')` 패턴이
ad·analytics·content·coupon·point·rules·segment **7곳 전부** 확인됨. 모든 form action에도 개별
`getCmsRoleForAction` + `hasSettingsAccess` 재검증 존재(coupon 5개 액션·point 3개·ad 3개·rules 3개
전부 확인, segment/content/analytics는 액션 자체가 없음).

### ⑤ analytics 게이트(AUDIT-BND-04) 스팟체크 — ✅ 정상, 회귀 없음
`src/routes/cms/promotion/analytics/+page.server.ts:26-29` — `hasSettingsAccess` 게이트 여전히
존재. 08-17 수정 이후 재발 없음.

---

## 2. 신규 발견

### [CRITICAL] `/api/cms/coupons/[id]/redemptions` — 페이지 게이트(manager+)와 API 게이트(전체 cms_role) 불일치, 권한우회로 고객 PII 노출

- **파일**: `src/routes/api/cms/coupons/[id]/redemptions/+server.ts:19-20`
- **재현조건**: cms_role='partner' 계정으로 로그인한 상태에서 `/cms/promotion/coupon` 페이지 접근은
  `load()`의 `hasSettingsAccess` 게이트에 막혀 리다이렉트되지만, 이 화면이 내부적으로 호출하는
  API(`GET /api/cms/coupons/{쿠폰ID}/redemptions`)를 브라우저 개발자도구·curl 등으로 직접 호출하면
  `getCmsRoleForAction(locals)`가 `if (!cmsRole) return 401`만 검사하고 `hasSettingsAccess` 검사가
  없어 **partner도 200 응답을 그대로 받는다**.
- **근본 원인**: DB 함수 `get_coupon_redemptions`가 Migration 297에서 `is_cms_user()`(모든
  cms_role 통과) 체크로 만들어졌다가, Migration 298에서 "service_role 호출은 애초에 auth.uid()가
  채워지지 않아 항상 ACCESS_DENIED로 실패하는 구조적 버그"를 고치면서 DB 레벨 체크 자체를
  제거하고 "앱 레벨(`getCmsRoleForAction`)이 이미 권한을 확인했으니 DB는 service_role 전용
  GRANT만으로 충분하다"는 전제로 재작성됐다(주석에 명시). 그런데 정작 그 "앱 레벨" 체크가
  `getCmsRoleForAction`의 반환값 존재 여부만 볼 뿐 `hasSettingsAccess`(manager+)를 호출하지
  않아, 실제로는 어떤 등급 검증도 남아있지 않은 상태다. Migration 299/300/301(같은 날 후속
  랜딩UX 수정)도 이 권한 체크 공백을 건드리지 않고 그대로 유지했다.
- **영향 범위**: 응답에 `userName`·`userEmail`(고객 PII), `redeemedCode`(실채번 쿠폰 코드),
  `reservationId`+`cmsPath`(그 고객의 최근 예약 상태)가 쿠폰 ID 하나당 전량 포함된다. 쿠폰
  ID는 UUID이지만 `/cms/promotion/coupon` 목록 API가 이미 활성 쿠폰 전체를 partner 세션에도
  내려주는지 여부와 무관하게(§ 아래 부가발견 참고), coupon_id를 어떤 경로로든 알아낸 partner가
  이 엔드포인트로 임의 쿠폰의 사용자 PII 전량을 열람할 수 있다. security-auth.md 역할별 CMS
  접근 매트릭스는 "프로모션 쿠폰 = manager 이상"으로 명시하고 있어 이 결함은 그 정책을 정면
  위반하는 권한우회다.
- **수정 방향(참고용, 이번 세션은 read-only라 미적용)**: `+server.ts`에 `hasSettingsAccess(cmsRole)`
  체크 한 줄만 추가하면 해소된다 — DB 함수는 이미 service_role 전용으로 잠겨 있어 변경 불필요.

### [BOUNDARY] `/api/cms/chat/coupon-gift/direct-send` — sequenced 모드 쿠폰 발송 시 안내 문구 누락(approve_pending_coupon_gift와 동일 원칙이 sibling 경로에는 미적용)

- **파일**: `src/routes/api/cms/chat/coupon-gift/direct-send/+server.ts:60-105`,
  `src/routes/api/cms/coupons/available/+server.ts:24-32`, `src/lib/components/chat/ChatInput.svelte:460`
- **재현조건**: sequenced 모드 쿠폰(§14, `code=NULL`)이 활성+유효기간 내 상태면
  `/api/cms/coupons/available`가 `code` 컬럼을 그대로 포함해 반환(=null)하고, `ChatInput.svelte`의
  쿠폰 선물 피커가 `{coupon.code}`를 코드 칩으로 렌더링(빈 칩으로 표시, 어느 코드인지 티 안 남).
  관리자가 이걸 골라 "직접발송"하면 `direct-send/+server.ts`가 `coupon.code`(=null)를 그대로
  `action_payload.coupon_code`에 넣어 채팅카드를 생성한다. `ActionCard.svelte`가 `{#if
  payload.coupon_code}`로 감싸 "null" 문자열이 노출되진 않지만(2026-08-06 이전 유사 버그와
  달리 문자 그대로 새는 건 아님), 고객은 승인대기형(`approve_pending_coupon_gift`)이 제공하는
  "쿠폰이 발급되었습니다. 결제 시 자동으로 적용됩니다." 같은 안내 문구를 전혀 받지 못하고
  코드 칩 자체가 통째로 사라진 카드만 받는다.
- **영향 범위**: 화폐가치 조작이나 권한우회는 아니며(쿠폰 발급 자체는 `distribute_coupon`을
  정상 경유해 `user_coupons`에 실제로 적립됨, 체크아웃 시 `use_coupon`이 정상 채번), 순수
  UX/정책 일관성 결함 — Migration 293 B-6이 "sequenced 모드는 코드를 직접 노출하지 않고
  안내 문구로 대체한다"는 원칙을 세웠지만, `direct-send`(즉시발송, 2026-08-16 Migration
  266 최초 도입 — 지연채번보다 이틀 먼저 존재)는 그 이후 지연채번 도입(2026-08-18) 시점에
  함께 갱신되지 않았다.
- **참고**: `approve_pending_coupon_gift`(승인대기형)는 이 원칙을 정확히 지킨다(위 ③ 항목).
  두 경로가 "쿠폰을 채팅으로 보낸다"는 동일 기능의 서로 다른 UX 변형이라 원칙이 한쪽에만
  적용된 전형적 부분수정 패턴.

### [BOUNDARY] `/api/cms/segment/refresh` — manager+ 게이트 없이 모든 cms_role이 세그먼트 재계산 트리거 가능

- **파일**: `src/routes/api/cms/segment/refresh/+server.ts:13-21`
- **재현조건**: `/cms/promotion/segment` 페이지 자체는 `hasSettingsAccess` 게이트가 있지만,
  그 화면이 호출하는(추정) `refresh_user_segments` RPC 엔드포인트는 `cms_role` 존재 여부만
  검사(`if (!profile?.cms_role) return 403`)하고 등급을 보지 않는다.
- **영향 범위**: 화폐가치·PII 노출은 없음(세그먼트 재계산은 집계 갱신일 뿐 응답에 데이터를
  싣지 않음) — partner가 이 API를 직접 호출해도 얻는 정보는 성공/실패 여부뿐이라 실질 피해는
  낮지만, security-auth.md 매트릭스상 "프로모션 세그먼트 = manager 이상" 원칙과는 어긋난다.
  위 CRITICAL 항목과 동일한 클래스(페이지 게이트 vs API 게이트 불일치)의 경미한 재발 사례로
  함께 기록.

---

## 3. 부가발견 (등급 미부여 — 정보성)

- `src/routes/api/cms/coupons/available/+server.ts`는 `available` 쿠폰 목록(코드 포함, manual
  모드는 실제 코드 원문 그대로)을 `cms_role` 존재 여부만으로 반환한다. 목적(채팅 쿠폰선물
  피커)상 partner도 열람 가능해야 정상 동작할 여지는 있으나(직접발송 자체는 `direct-send`에서
  manager+로 막혀 있음), manual 쿠폰 코드 원문이 partner에게도 노출된다는 점은 "코드를 알면
  누구나 쓸 수 있는" manual 모드 특성상 낮은 수준의 정보노출로 볼 수 있어 별도 등급 없이
  기록만 남김 — 정책 판단은 Stephen 확인 필요 영역.

---

## 4. 자체 오인점검 (misidentifications.md 대조)

- 과거 세션에서 "타입 정의 파일(database.ts)이나 RPC 이름 패턴만 보고 실제 DB 정의를 확인하지
  않아 오판"한 사례(2026-09-01 두 건)가 기록돼 있어, 이번 감사에서는 모든 CRITICAL/BOUNDARY
  판단 전에 반드시 최신 `CREATE OR REPLACE FUNCTION` 정의를 계보 순서(생성일 오름차순)로 직접
  Read해 "가장 나중에 재정의된 버전"을 근거로 삼았다(`get_coupon_redemptions`: 297→298→299→
  300→301 전부 확인, `use_coupon`: 267→291→292→293→296→297→348→395(호출부만) 전부 확인).
  또한 "과거 마이그레이션을 근거로 인용할 때 실제로 열어보지 않고 기억에 의존해 서술한" 과거
  오인(2026-09-01 anon lockdown 건)을 의식해, 이번 CRITICAL 발견의 근거 문장(Migration 297→298
  변경 배경)도 298 파일의 주석 원문을 그대로 인용해 서술했다.
- 이번 감사는 read-only 지시를 준수해 코드 수정을 전혀 하지 않았다(수정 방향은 참고용 서술만).
