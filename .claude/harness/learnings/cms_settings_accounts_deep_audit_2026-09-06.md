# CMS 설정·계정관리 전역 정밀검증 (A7 트랙) — 2026-09-06

## 요약 (3줄)

- security-auth.md의 계정관리 권한게이트(requireTrueSuperadmin/requireAccountMutationAccess/
  requireNotLastSuperadmin)와 codes(`/cms/codes`)의 manager+/superadmin 게이트는 코드와 문서가
  완전히 일치 — 새로운 취약점 없음(CRITICAL 0건).
- `rental-cms-settings.md`가 서술한 3플래그(`is_bulk_delivery`/`is_courier_dependent`/
  `is_delivery_type`) 독립성은 현재 코드(cart/+page.svelte, Migration #444)와 정확히 일치하나,
  `/cms/set/rental/+page.server.ts`의 JSDoc 주석 1곳이 Migration #444로 폐기된 옛 상호배타
  가드를 여전히 "존재하는 규칙"처럼 서술 — 5차례 뒤집힌 이력이 있는 영역에서 재발 위험 있는
  문서 드리프트(BOUNDARY).
- `/cms/set/code`(+ 그 상위 `/cms/set` bare)는 GNB 어디서도 연결되지 않는 죽은 스텁 리다이렉트,
  `/cms/set/admin`은 GNB에 연결돼 있지만 클릭 시 즉시 `/cms/accounts/list`로 302 리다이렉트되는
  불필요한 이중 홉 구조(둘 다 ROUTINE, 삭제/정리 후보로만 기록·미수정).

---

## 1. 레거시 `/cms/set/code` 라우트 — 죽은 라우트 확정

`src/routes/cms/set/code/+page.server.ts`는 `.svelte` 파일 없이 `load()`가 즉시
`redirect(302, '/cms/codes')`만 실행한다. `cmsMenus.ts`의 `CMS_MENUS.settings.code`는
`href: '/cms/codes'`로 **직접** 등록돼 있어(코드설정 메뉴는 `/cms/set/code`를 전혀 경유하지
않음), GNB 어디에서도 이 경로로 연결되지 않는다.

- `src/__tests__/services/cmsMenus.test.ts:130-132`가 이미 "구 스텁 경로(/cms/set/code)는
  더 이상 CMS_MENUS에 매핑되지 않는다"를 명시적으로 검증하고 있어, 이 상태는 실수가 아니라
  기존에 알려진 레거시 잔재다.
- 상위 `src/routes/cms/set/+page.server.ts`도 `load()`가 즉시 `redirect(302, '/cms/set/code')`만
  실행 — `/cms/set` bare 경로 자체도 GNB의 어떤 항목에도 href로 등록돼 있지 않다(설정
  대메뉴는 href 없이 서브메뉴 드롭다운만 가짐).
- 결과: `/cms/set` → `/cms/set/code` → `/cms/codes` 2단 리다이렉트 체인 전체가 오직 과거
  북마크·직접 URL 타이핑으로만 도달 가능한 완전한 죽은 코드. 등급: **ROUTINE**(기능·보안
  영향 없음, 삭제 후보로만 기록 — 수정하지 않음).

같은 계열로 `/cms/accounts/codes/+page.server.ts`(301 영구 리다이렉트 → `/cms/codes`)도
자체 주석에 "구 경로 → 신 경로 영구 리다이렉트"로 명시된 동일 성격의 의도된 레거시 스텁이다
— 참조하는 곳 0건(grep 확인), 이쪽은 코드 자체가 자기 목적을 정확히 문서화하고 있어 신규
발견 사항 아님.

## 2. `/cms/set/admin` — 죽은 라우트 아님, 그러나 불필요한 이중 홉

`/cms/set/admin/+page.server.ts`는 `.svelte` 없이 `load()`가 즉시
`redirect(302, '/cms/accounts/list')`만 실행한다. 다만 이 경로는 `cmsMenus.ts`의
`settings.admin`(`href: '/cms/set/admin', requiresSettingsAccess: true`)에 **실제로 등록돼
있어 GNB "설정 > 관리정보" 클릭 시 실제로 이 경로를 거친다** — `/cms/set/code`와 달리 죽은
코드가 아니라 매 클릭마다 실제로 발생하는 불필요한 서버 왕복 1회다.

`src/routes/cms/+layout.svelte:130`이 `sub.href === '/cms/set/admin' && pathname.startsWith
('/cms/accounts')`로 활성 탭 하이라이트를 특별 처리하고 있어, 이 우회 구조 자체는 의도된
설계로 보인다(GNB href를 직접 `/cms/accounts/list`로 바꾸지 않고 특별 처리를 추가하는 쪽을
선택한 것으로 추정). 기능·보안 영향은 없음 — 등급 **ROUTINE**(효율성 개선 후보로만 기록).

`/cms/set/signature`(관리자 서명·직인 자산)는 GNB `CMS_MENUS`에는 아예 등록돼 있지 않고
`SealAssetPicker.svelte`·`ContractCanvasFieldPalette.svelte`에서 컨텍스트 링크(`target="_blank"`)
로만 연결된다 — `load()`에 자체 `hasSettingsAccess` 게이트가 있어 메뉴권한 오버레이
(`hasMenuAccess`) 적용 대상이 아니어도 보호는 유지된다. 정상, 신규 발견 없음.

## 3. security-auth.md 게이트 정확성 — 일치 확인 (CRITICAL 0건)

`src/lib/server/requireTrueSuperadmin.ts` 직접 대조 결과:

- `requireTrueSuperadmin()`은 `getRoleLevel(profile.cms_role) !== ROLE_LEVEL.superadmin`으로
  **정확히 100**만 통과시킨다 — `hasSettingsAccess()`(≥50)와 혼동 없음.
- `requireAccountMutationAccess()`는 대상(target) 계정의 실시간 `cms_role`을 조회해 대상이
  superadmin이면 `requireTrueSuperadmin`으로, 아니면 `hasSettingsAccess`(manager+)로 분기 —
  설계 그대로.
- `requireNotLastSuperadmin()`은 대상이 superadmin이 아니면 즉시 통과, superadmin이면
  전체 superadmin 카운트가 1 이하일 때만 차단 — toggleSuspend/toggleConcurrent/toggleSession
  에는 호출되지 않음(cms_role을 바꾸지 않는 액션이므로 설계대로 제외).

`src/routes/cms/accounts/list/+page.server.ts` 전수 확인 — `updateName`·`updatePhone`·
`updateRole`·`toggleConcurrent`·`toggleSession`·`toggleSuspend`·`delete` **7개 액션 전부**
`requireAccountMutationAccess()`를 첫 번째 게이트로 호출한다(security-auth.md가 2026-08-26
후속에서 지적한 `updatePhone` 누락 취약점은 이미 해소된 상태로 재확인). `updateRole`·`delete`
에는 `requireNotLastSuperadmin()`도 추가로 호출됨. `delete`는 `userId === session.user.id`로
자기 자신 삭제도 별도 차단.

`src/routes/cms/accounts/+page.server.ts`의 `createAccount`는 `newAccountRole === 'superadmin'`
일 때만 `requireTrueSuperadmin()`을 추가로 요구 — manager는 `hasSettingsAccess` 통과만으로
manager/partner 계정은 생성 가능하지만 superadmin 계정 생성은 차단됨. 문서 그대로.

`src/routes/api/cms/accounts/[id]/menu-permissions/+server.ts` — manager+ 게이트 +
`roleAllowsMenuByDefault()`로 "narrow-only"(좁히기 전용) 서버단 강제 확인. 추가로 문서에
없던 EC-5(자기 자신을 대상으로 하는 메뉴권한 변경 self-service 차단)도 구현돼 있음 — 이는
보안 강화 방향의 초과 구현이라 문제 아님, 문서 갱신 후보로만 기록.

`src/routes/api/cms/accounts/[id]/login-logs/+server.ts` — `canViewLoginLogs()` 순수함수로
본인/manager+ 판정, `AccountDetailPanel.svelte:694`가 `parseUserAgent()`로 가공 표시(원문 UA
직접 렌더링 없음, grep으로 다른 노출 지점 없음 확인) — 문서와 완전 일치.

`src/lib/server/cmsAdminAuditLog.ts` — 8종 action_type 그대로, try/catch로 fail-soft,
UPDATE/DELETE 없음(append-only) — 문서와 일치.

`/cms/codes/+page.server.ts` — `load()`에 `hasSettingsAccess` 페이지 진입 게이트 존재(라인
142-150, QR-CASE-2 후속으로 명시), 액션 20개 중 `transferCode` 1개만
`checkSuperadmin()`(문자열 `cms_role === 'superadmin'` 직접 비교, `getRoleLevel` 미사용이지만
결과적으로 동일 판정), 나머지 19개 전부 `getCmsRoleForAction()` + `hasSettingsAccess()` —
문서 서술과 정확히 일치. `getCmsRoleForAction()` 헬퍼 사용 원칙(form action에서
`locals.cmsRole` 직접 참조 금지)도 전 액션에서 준수됨.

## 4. `rental-cms-settings.md` 3플래그 독립성 — 코드 일치, 문서 드리프트 1건 발견

`src/routes/cart/+page.svelte:84-106`의 `isDeliveryLocked`(is_bulk_delivery) /
`isDeliveryTypeMethod`(is_delivery_type) / `isCourierDependent`(is_courier_dependent) 3개
판정 함수는 서로 완전히 독립적으로 구현돼 있고, 요금·`deliveryLocked` 판정은 전부
`isDeliveryTypeMethod` 기준(라인 884-999 주석에 교체 경위 상세 기술)으로 통일돼 있다 —
`rental-cms-settings.md`가 2026-09-06 갱신에서 서술한 최신 상태와 정확히 일치. Migration
#444(`20260904040000_444_rental_method_flags_allow_coexist.sql`) 직접 대조 결과 두 토글
RPC(`toggle_rental_method_bulk_delivery`/`toggle_rental_method_delivery_type`)에서 실제로
상호배타 `RAISE EXCEPTION` 블록이 제거돼 있음을 확인 — 현재 DB 함수 정의는 문서와 일치.

**BOUNDARY 발견** — `src/routes/cms/set/rental/+page.server.ts:35-39`의
`RentalMethodOption.is_delivery_type` 필드 JSDoc이 여전히 다음과 같이 서술한다:

> "같은 방식이 두 플래그를 동시에 true로 가질 수 없다(toggle RPC 상호배타 가드, Migration
> #441). 별도 마스터 토글 없음(is_delivery_type=true 존재 자체가 활성화 조건)."

이 상호배타 서술은 Migration #444(2026-09-04, `rental_method_flags_allow_coexist.sql`)로
이미 폐기된 규칙이다(§4 상단 확인대로 RPC 자체에 가드가 없음). 코드 동작 자체는 정확하지만,
이 JSDoc은 향후 세션이 `is_bulk_delivery`/`is_delivery_type` 관련 작업을 할 때 "아직도
상호배타여야 한다"는 잘못된 전제로 코드를 읽게 만들 수 있다 — 이 두 플래그를 둘러싼 설계가
Migration #339→#386→#440→#441→#443→#444로 5차례 뒤집혀 이미 최소 2건의 회귀를 유발했다고
`rental-cms-settings.md`가 명시한 바로 그 영역이라, 스테일 주석 하나가 6번째 회귀의 단초가
될 위험이 문서 자체가 경고하는 패턴과 정확히 일치한다. **영향범위**: 주석뿐이므로 즉시
장애는 없음 — 재현조건은 "다음 세션이 이 JSDoc만 보고 상호배타 가드를 재도입하거나, 반대로
가드가 아직 있다고 오판해 불필요한 사전검증을 추가하는 경우". 등급: **BOUNDARY**(문서·코드
정합성 문제, 실사용 영향 없음, 수정 범위는 주석 1곳뿐이라 위험 낮음이나 반복 이력이 있는
민감 영역이라 상향).

`/cms/set/rental/+page.server.ts`의 23개 액션(문서가 "20개"로 서술한 것과 실제 카운트가
약간 다름 — `addPeriod`부터 `deleteDiscountTier`까지 정확히 23개) 중 `syncHolidaysNow` 1개만
`hasSettingsAccess` 검사가 있고 나머지 22개는 세션 존재만 확인 — `rental-cms-settings.md`가
이미 "보안 검토 대상"으로 명시한 기존 갭이며 신규 발견 아님(카운트 오차만 참고용으로 기록,
문서 정정 필요 시 "20개"를 "22개"로 교체 권장 — 별도 조치 불필요한 수준의 오타성 차이).

## 5. `process_payment_and_create_order` — RPC는 실존, 앱코드 wrapper는 완전한 고아

- Supabase MCP로 stage(`ezyvffjvuwmtuhpxdjrw`) 직접 조회 확인:
  `SELECT proname, pronargs FROM pg_proc WHERE proname='process_payment_and_create_order'`
  → `{"proname":"process_payment_and_create_order","pronargs":4}` — **RPC는 DB에 실존**한다.
  task 배경에서 우려한 "호출 시 즉시 에러나는 죽은 RPC"는 아니다.
- 다만 `src/lib/services/supabase.ts:184-198`의 `rpc.processPaymentAndCreateOrder` wrapper는
  grep 결과 자기 자신의 정의부 외 참조 0건 — 앱 코드 어디에서도 호출되지 않는 죽은 클라이언트
  래퍼다.
- `payment.md`(v4.0, 2026-08-31 전면개정)의 "삭제된 레거시 경로" 절은 보존된 고아 RPC로
  `confirm_payment_and_update_reservation`/`cancel_payment_and_release_hold`/
  `atomic_reserve_asset`/`calculate_cart_total` 4개만 나열하고 `process_payment_and_create_order`
  는 언급하지 않는다 — 같은 계열(Migration 29, `payment/success`·`api/payment/confirm` 등
  이미 삭제된 라우트가 전용으로 쓰던 것으로 추정)의 고아 RPC가 문서의 그 목록에서 누락돼
  있음. **등급: ROUTINE**(문서 완결성 갭 — 기능·보안 영향 없음, 이 wrapper 자체가 이미 죽은
  코드라 호출 경로도 없음). scope 상 payment.md 직접 수정은 하지 않고 기록만 함.

---

## 부가 발견 (경미)

- `src/routes/cms/accounts/+page.server.ts:96` `console.error('[cms/accounts]
  cms_create_invite_token 실패:', ...)` — core-rules.md는 `console.log` 금지만 명시하고
  `console.error`는 별도 언급이 없어 규칙 위반은 아니나, GATE C "console.log 전수 제거"
  취지상 참고용으로만 기록.
- `checkSuperadmin()`(`/cms/codes/+page.server.ts:61-68`)이 `getRoleLevel()` 공용 헬퍼 대신
  `cms_role === 'superadmin'` 문자열 직접 비교를 쓴다 — 현재 role 값 3종(partner/manager/
  superadmin)에서는 결과가 동일해 버그는 아니지만, `requireTrueSuperadmin.ts`가 이미
  `getRoleLevel` 기반 공용 패턴을 확립해둔 상태라 새 코드에서 굳이 별도 구현을 쓴 것 — 통일
  기회로만 기록(기능 차이 없음).

## 자체 오인점검

`misidentifications.md` 대조 결과 이번 트랙과 직접 겹치는 과거 오인 사례는 없었음. 이번
검증에서 "RPC가 DB에 없을 것"이라는 배경 가정(item 5)이 실제로는 "RPC는 있으나 호출부가
없다"로 나와, 최초 가설을 그대로 확정하지 않고 Supabase MCP로 직접 재확인한 뒤 결론을
correction한 과정을 기록해둔다(가정과 다른 결과가 나왔을 때 가정 쪽을 그대로 보고서에
싣지 않고 실측값으로 교체한 사례).
