# security-auth.md — 인증·권한·RLS 규칙
# Harness Flow v3.1 | 보안 도메인

---

## 인증 구조

```
Supabase Auth (JWT 기반)
- 세션 관리: @supabase/ssr (서버사이드 세션 동기화)
- 클라이언트 상태: src/lib/stores/auth.ts ($state 기반)
- 자동 갱신: Supabase Auth 내장 (refresh_token 사용)
```

---

## SvelteKit 인증 패턴

```typescript
// src/hooks.server.ts — 모든 요청에 세션 주입
import { createServerClient } from '@supabase/ssr'

export const handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { /* cookie helpers */ } }
  )

  event.locals.safeGetSession = async () => {
    const { data: { session } } = await event.locals.supabase.auth.getSession()
    return { session }
  }

  return resolve(event)
}

// +page.server.ts — 보호된 페이지
export const load = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/login')
  return { session }
}
```

---

## RLS 정책 원칙

```sql
-- 고객은 자신의 데이터만 읽기
CREATE POLICY "user_own_data" ON rental_reservations
  FOR SELECT USING (auth.uid() = user_id);

-- 고객은 자신의 데이터만 수정 (RPC 경유 시 service_role 사용)
CREATE POLICY "user_own_update" ON rental_reservations
  FOR UPDATE USING (auth.uid() = user_id);

-- 관리자 전체 접근 (service_role 키 필요)
-- ⚠️ service_role 키는 서버사이드 전용
```

---

## 권한 레벨

```
anon          : 비인증 사용자 (상품 목록 조회만)
authenticated : 로그인 사용자 (예약·결제·마이페이지)
service_role  : 서버 RPC 함수 내부 (클라이언트 코드 절대 사용 금지)
```

---

## CMS 관리자 역할 (cms_role) — 2026-07-23 확정

### 역할 레벨

```
src/lib/utils/cmsPermissions.ts

ROLE_LEVEL = { superadmin: 100, manager: 50, partner: 10 }

hasSettingsAccess(role) → getRoleLevel(role) >= 50
  → manager·superadmin 통과 / partner 차단
```

### 역할별 CMS 접근 매트릭스

| CMS 화면 | 라우트 | partner(10) | manager(50) | superadmin(100) |
|---|---|---|---|---|
| 상품 관리 | `/cms/products` | ✅ 세션만 | ✅ | ✅ |
| 예약 목록 | `/cms/reservation` | ✅ 세션만 | ✅ | ✅ |
| 대여 현황 | `/cms/rentals` | ✅ 세션만 | ✅ | ✅ |
| 상품 이력관리 | `/cms/rental/history` | ✅ 세션만 | ✅ | ✅ |
| 계약서 양식·발행·발송 | `/cms/reservation/contracts` (load/create/update/softDelete=4곳), `/api/cms/reservations/[id]/init-contract`(1), `/api/cms/reservations/[id]/contract-data`(1), `/api/cms/contracts/[id]/content` GET+PATCH(2), `/api/cms/contracts/[id]/send-chat`(1) — 5개 파일·9곳 게이트 | ❌ | ✅ | ✅ |
| 전자계약 발행취소(서명완료건 포함, 2026-09-07) | `/cms/reservation` → `cancelIssuedContract` — `discardSentContract`(미서명 발송건 전용)와 동일 게이트 기준 | ❌ | ✅ | ✅ |
| 완료 전자계약 정보 채팅 재공유(2026-09-08) | `/api/cms/contracts/[id]/share-chat` — `send-chat`과 동일 게이트 기준(서명 완료건만 대상, 재발행·재발송 아님) | ❌ | ✅ | ✅ |
| 관리자 서명·직인 자산 관리 | `/cms/set/signature` | ❌ | ✅ | ✅ |
| 대여 설정 | `/cms/set/rental` | ❌(2026-09-15 확정, 아래 참고) | ✅ | ✅ |
| 고객 관리(열람) | `/cms/customers` | ✅ 계정별 권한설정으로 On/Off(2026-09-15 확정, 기본값 허용) | ✅ | ✅ |
| 고객 관리(편집·삭제·블랙리스트·점수·포인트) | `/cms/customers` → `toggleBlacklist`·`cancelSubscription`·`updateCustomerInfo`·`adjustScore`·`grantCustomerPoints`·`deleteCustomer` | ❌ | ✅ | ✅ |
| 레거시 회원 일괄 등록 | `/cms/customers/legacy-import` | ❌ | ✅ | ✅ |
| 구독 관리 | `/cms/subscriptions`, `/cms/subscriptions/new` | ❌ | ✅ | ✅ |
| 프로모션 배너 | `/cms/promotion/ad` | ❌ | ✅ | ✅ |
| 프로모션 쿠폰 | `/cms/promotion/coupon` | ❌ | ✅ | ✅ |
| 프로모션 포인트 | `/cms/promotion/point` | ❌ | ✅ | ✅ |
| 계정 생성 | `/cms/accounts` | ❌ | ✅ | ✅ |
| 계정 목록·수정 | `/cms/accounts/list` | ❌ | ✅ | ✅ |
| 코드 이관 | `/cms/codes` → `transferCode` | ❌ | ❌ | ✅ |
| 코드설정 기타 전체(20개 액션 중 19개) | `/cms/codes` → `addCode`·`editCode`·`deleteCode`·`toggleActive`·`saveFormat`·`updateCodeRule`·`saveMapping`·`savePrefixCodes`·`addGroup`·`editGroup`·`deleteGroup`·`toggleGroupActive`·`toggleGroupProductFilter`·`toggleGroupPartnerType`·`addGroupItem`·`updateGroupItemSettings`·`removeGroupCombo`·`removeGroupItem`·`removeComboItem` | ❌ | ✅ | ✅ |
| 상품 코드 재반영(2026-08-25) | `/cms/products` → `reassignCodeSeries`(재고 0개 부모상품의 기준 품번 재할당, products.md §2-11) | ❌ | ✅ | ✅ |
| 환불 처리(2026-08-29) | `/api/cms/reservations/[id]/payment` PUT → Toss 전액취소 API + `cancel_reservation_payment` RPC (결제정보 탭 "환불 처리" 버튼) | ❌ | ✅ | ✅ |
| 두발히어로 배송 API(2026-08-31) | `/api/cms/reservations/[id]/dhero` GET·POST — 두발히어로 배송 주문 조회·생성 / `/api/cms/reservations/[id]/dhero/cancel` PUT — 배송 취소 / `/api/cms/reservations/[id]/dhero/return` POST — 반납 배송 등록 (4개 핸들러 전부 — RSV-B-B6, `hasSettingsAccess` 적용) | ❌ | ✅ | ✅ |
| 계정 상세 조회 | `/cms/accounts/list` → `AccountDetailPanel` — 기본정보·권한설정·접속로그 탭 열람 | ❌ | ✅ | ✅ |
| 계정 이름 수정 | `/cms/accounts/list` → `updateName` | ❌ | ✅(대상이 partner/manager일 때) | ✅ |
| 계정 휴대번호 수정 | `/cms/accounts/list` → `updatePhone` | ❌ | ✅(대상이 partner/manager일 때) | ✅ |
| 계정 정지/복원 | `/cms/accounts/list` → `toggleSuspend` | ❌ | ✅(대상이 partner/manager일 때) | ✅ |
| 계정 삭제 | `/cms/accounts/list` → `delete` | ❌ | ✅(대상이 partner/manager일 때만 — 대상이 superadmin이면 차단) | ✅ |
| 관리자 등급(cms_role) 변경 | `/cms/accounts/list` → `updateRole` | ❌ | ❌(대상이 superadmin이거나 승격 대상이 superadmin이면 차단) | ✅ |
| superadmin 계정 신규 생성 | `/cms/accounts` → `createAccount` (newAccountRole='superadmin') | ❌ | ❌ | ✅ |
| 메뉴별 세부 접근권한 설정 | `/api/cms/accounts/[id]/menu-permissions` PUT | ❌ | ✅(대상이 partner/manager일 때만 — 대상이 superadmin이면 requireAccountMutationAccess로 차단. 대상이 superadmin이 아니어도 슈퍼마스터가 OFF로 잠근 항목을 ON으로 되돌리는 것은 불가 — 아래 참고) | ✅(자기 자신 대상 포함 — EC-5 self-service 차단의 유일한 예외, 2026-09-15 후속) |
| 중복 로그인 허용 토글 | `/cms/accounts/list` → `toggleConcurrent` | ❌ | ✅ | ✅ |
| 세션 제한 토글 | `/cms/accounts/list` → `toggleSession` | ❌ | ✅ | ✅ |
| 접속로그 조회 | `/api/cms/accounts/[id]/login-logs` — 본인 계정 또는 manager+ | ❌(타인 조회) | ✅(본인·타인 모두) | ✅ |

> ℹ️ **최소 보장(2026-09-25)**: 표의 액션에 개별 역할 확인이 없더라도 hooks 중앙 게이트가 /cms/** 변경 요청의 CMS 직원 여부(어떤 cms_role이든)를 보장한다. 등급별(manager 이상 등) 제한은 여전히 액션별 게이트 소관.

> ⚠️ **계정 관리 권한 핵심 원칙 (2026-08-26 확정)**: 모든 "대상이 superadmin인 액션"은
> `requireTrueSuperadmin()` 전용 게이트를 통과한 호출자(진짜 superadmin)만 실행할 수 있다.
> `hasSettingsAccess()`(manager 이상, level≥50)로는 이 게이트를 통과할 수 없으며,
> 두 함수는 이름조차 혼동되지 않도록 완전히 분리돼 있다(`src/lib/server/requireTrueSuperadmin.ts`).
>
> 마지막 남은 superadmin 보호: `requireNotLastSuperadmin()` — superadmin이 1명만 남았을 때
> 그 계정의 강등/삭제를 호출자 등급과 무관하게 차단한다(시스템 잠금 방지).
>
> manager가 "partner/manager 대상"만 조작 가능한 이유: `requireAccountMutationAccess()`가
> 대상 계정의 cms_role을 실시간으로 확인해, 대상이 superadmin이면 manager 호출자를 차단한다.
> 기존 `requireSuperadmin()`이 실제로는 manager+ 수준만 검사하던 구현 버그(2026-08-26 발견·수정).
>
> ⚠️ **파트너 접근범위 재조정 3건(2026-09-15, Stephen 지시)**:
>   - **대여 설정(`/cms/set/rental`) 완전 차단**: `cmsMenus.ts`의 `settings.rental`에
>     `requiresSettingsAccess: true`를 추가해 파트너를 role 기본값 단계에서 차단(GNB 메뉴 자체가
>     숨겨짐, 라우트 직접 접근도 `+layout.server.ts`가 차단). 이 화면의 `+page.server.ts`
>     액션(대여기간·대여방식·지점·배송설정·휴무일캘린더·이용안내·필수동의문·배송료우대설정 등
>     23개 전체)에도 `hasSettingsAccess(manager+)` 게이트를 새로 추가해, 페이지가 막혀도
>     액션에 직접 POST로 우회하는 경로를 함께 닫았다(과거엔 `syncHolidaysNow` 1곳만 게이트가
>     있었음).
>   - **고객목록(`customers.list`) 열람 허용**: `requiresSettingsAccess` 플래그를 제거해
>     role 기본값을 파트너도 허용으로 전환 — 관리자가 계정별 권한설정(On/Off)으로 개별 파트너의
>     열람 권한을 조정할 수 있다. 블랙리스트·회원정보수정·점수조정·포인트지급·구독취소·삭제 등
>     실제 데이터를 바꾸는 액션은 전부 그대로 `hasSettingsAccess(manager+)` 게이트가 유지되므로
>     "열람만 가능, 편집은 불가"라는 요구가 그대로 지켜진다.
>   - **GNB가 계정별 권한설정 오버라이드까지 반영**: `+layout.server.ts`가 메뉴권한 오버라이드를
>     경로 매칭 여부와 무관하게 항상 조회해 `+layout.svelte`로 넘기고, GNB(`mainMenus`)가
>     `hasMenuAccess()`(role + 오버라이드)로 대메뉴·서브메뉴를 필터링한다. 이전에는 role만 보고
>     GNB를 그렸기 때문에 (a) 계정별로 차단된 메뉴도 링크는 그대로 보이다가 클릭해야만 접근거부로
>     튕기는 죽은 링크 문제, (b) 서브메뉴가 전부 role상 차단된 대메뉴(예: 파트너에게 프로모션)도
>     빈 탭으로 계속 노출되는 문제가 있었다 — 이제 서브메뉴가 하나도 안 보이는 대메뉴는 GNB에서
>     자체적으로 숨겨진다.
>   - **슈퍼마스터 잠금**: `/api/cms/accounts/[id]/menu-permissions` PUT이 어떤 메뉴를
>     ON으로 되돌리려는 요청을 받으면, 그 메뉴를 마지막으로 OFF로 저장한 사람(`updated_by`)의
>     **현재** 등급을 조회한다 — 그 사람이 슈퍼마스터라면 지금 요청한 사람이 슈퍼마스터가 아닌 한
>     403과 함께 "슈퍼마스터 권한 계정에 문의하세요." 메시지를 반환한다(매니저가 끈 항목은
>     이 제약 없이 다른 매니저가 자유롭게 되돌릴 수 있음 — 잠금 대상은 슈퍼마스터가 끈 항목뿐).
>     별도 컬럼 없이 기존 스키마(`updated_by` + 현재 `cms_role` 조회)만으로 판정하므로, 그
>     사람이 이후 강등·승격되면 판정도 함께 달라진다(의도된 동작).
>
> ⚠️ **CRITICAL 발견·수정(2026-09-15)**: `/api/cms/accounts/[id]/menu-permissions` PUT은
> 계정목록의 다른 관리 액션(`updateName`·`updatePhone`·`toggleSuspend`·`delete`·`updateRole`·
> `toggleConcurrent`·`toggleSession`)과 달리 대상(target) 계정이 슈퍼마스터인지 확인하는
> `requireAccountMutationAccess()` 게이트가 처음부터 빠져 있었다 — 그 결과 매니저가 슈퍼마스터
> 계정을 대상으로 이 API를 직접 호출해 메뉴 접근을 OFF로 차단할 수 있었고(§13 "긴급 배지"류의
> UI 숨김과 달리 서버가 실제로 막지 않았음), 그 차단이 `+layout.server.ts`의 메뉴권한 오버레이를
> 통해 슈퍼마스터 본인의 실제 CMS 내비게이션에도 그대로 적용돼(오버레이는 role과 무관하게 항상
> 검사됨) 매니저가 슈퍼마스터의 화면 접근을 몰래 제한할 수 있는 상태였다. PUT 핸들러 앞단에
> `requireAccountMutationAccess()`를 추가해 다른 계정관리 액션과 동일한 기준으로 통일했다 —
> allowed=true(켜기)·allowed=false(끄기) 요청 둘 다 이 가드를 거친다(끄기 자체가 공격
> 시나리오였으므로 allowed 값과 무관하게 항상 검사). GET(열람)은 대상 무관 조회이므로 영향
> 없음. 회귀 테스트 2건 추가(`cmsMenuPermissionsApi.test.ts`).
>
> ⚠️ **EC-5 예외 신설(2026-09-15 후속, Stephen 지시)**: "자기 자신을 대상으로 하는 메뉴권한
> 변경 차단"(EC-5)이 슈퍼마스터에게도 예외 없이 적용돼, 다른 슈퍼마스터가 존재하지 않는 한
> 슈퍼마스터 본인이 스스로의 권한을 절대 되돌릴 수 없는 데드락이 실제로 발생했다(매니저가
> 유일한 슈퍼마스터 계정의 `consulting.chat` 권한을 OFF로 차단해둔 상태에서, 그 계정 본인도
> 자기 자신을 대상으로 할 수 없어 아무도 못 푸는 상태로 확인됨). PUT 핸들러의 EC-5 조건에
> `cmsRole !== 'superadmin'`을 추가해, **슈퍼마스터만** 자기 자신을 대상으로 한 메뉴권한
> 변경도 허용하도록 예외 처리했다 — manager는 이 차단이 그대로 유지된다(실수로 스스로를
> 잠그는 사고 방지 목적 자체는 manager에게는 여전히 유효). 슈퍼마스터가 자신에게 걸린
> "슈퍼마스터 잠금"(§ 위 단락)도 자기 자신이 그 잠금을 건 당사자이므로 자동으로 통과한다.
> 회귀 테스트 1건 추가(`cmsMenuPermissionsApi.test.ts`).
>
> ⚠️ **검사 순서 수정(2026-09-15 4차 후속, 실사용 중 발견)**: 위 EC-5 예외를 추가한 뒤에도,
> **매니저**가 "본인" 계정의 슈퍼마스터-잠금 항목을 켜려는 경우엔 여전히 문제가 남아 있었다 —
> EC-5(자기 자신 대상 차단)가 슈퍼마스터 잠금 검사보다 먼저 실행돼서, 실제 사유(슈퍼마스터가
> 잠갔다)가 EC-5의 뭉뚱그린 메시지("자기 자신의 메뉴 권한은 변경할 수 없습니다")에 가려져
> "슈퍼마스터 권한 계정에 문의하세요."라는 더 정확한 안내에 절대 도달하지 못했다. PUT
> 핸들러의 검사 순서를 바꿔 슈퍼마스터 잠금 검사(allowed=true 요청에 한함)를 EC-5보다 먼저
> 수행하도록 했다 — 대상이 자기 자신이든 아니든, 실제로 걸리는 사유가 슈퍼마스터 잠금이면
> 그 구체적 사유를 항상 우선 반환하고, 잠금 대상이 아닐 때만 EC-5의 일반 차단으로 넘어간다.
> 회귀 테스트 1건 추가(`cmsMenuPermissionsApi.test.ts`), 기존 3건은 저장 RPC 미호출
> 검증 방식으로 갱신(조회 RPC는 이제 거부 경로에서도 호출되므로).
>
> ⚠️ **후속 발견(2026-08-26, QA Stage 9)**: 위 수정 당시 `updatePhone` 액션 1곳만 옛
> `requireSuperadmin()` 호출이 그대로 남아 있어(다른 5개 액션 + `updateName`은 이미
> `requireAccountMutationAccess()`로 교체됐으나 `updatePhone`만 누락), manager가 superadmin
> 대상의 휴대번호를 변경할 수 있는 동일 클래스의 취약점이 잠깐 남아 있었다 — 같은 날 발견 즉시
> `updatePhone`도 `requireAccountMutationAccess()`로 교체해 해소(`src/routes/cms/accounts/
> list/+page.server.ts`, 회귀 테스트: `accountsListSuperadminGuard.test.ts`). 이제 대상이
> superadmin인 계정 관리 액션은 예외 없이 이 게이트를 거친다.

> ⚠️ **QR-CASE-2(2026-08-XX 확정)**: `/cms/codes`의 액션 20개 중 `transferCode`만 superadmin
> 게이트가 있었고, `saveFormat`(전 카테고리·전 상품의 향후 채번 방식을 좌우하는 전역 설정) 포함
> 나머지 19개는 세션 체크만 있어 partner도 변경 가능한 무방비 상태였다. 전 카테고리 코드
> 추가/수정/삭제, 조합코드그룹 관리 등은 전부 다른 상품·다른 파트너에게 영향을 주는 전역
> 설정이라 전부 manager 이상(`hasSettingsAccess`)으로 통일 게이트했다.
>
> ⚠️ **QA 후속(2026-08-XX)**: 액션만 막고 페이지 자체는 role과 무관하게 항상 렌더링돼, partner가
> 들어가면 모든 버튼이 보이는데 클릭해야만 403이 나는 혼란스러운 상태였다 — `/cms/codes`
> `load()`에 `const { cmsRole } = await parent(); if (!hasSettingsAccess(cmsRole ?? ''))
> throw redirect(303, '/cms?notice=access_denied')`를 추가해(accounts/customers 등 기존
> manager+ 전용 페이지와 동일 패턴) 페이지 진입 자체를 막았다 — `/cms/codes`는 이제 예외 없이
> partner 접근 불가.

### 메뉴별 세부 접근권한 (계정 오버레이 모델, 2026-08-26 확정)

```
cms_menu_permissions 테이블 (Migration #350) — 계정(user_id) × 메뉴(menu_key) 단위로
allowed BOOLEAN 값을 저장하는 오버레이 레이어.

핵심 원칙 — "좁히기 전용":
  - role(partner/manager/superadmin) 기반 hasRouteAccess()가 허용하는 범위를 절대 넘어설 수 없다.
  - menu_key별 오버레이는 해당 계정의 role이 원래 허용하는 메뉴만 추가 차단(allowed=false)할 수 있다.
  - role이 원래 차단하는 메뉴(hasRouteAccess=false)에 allowed=true 레코드를 API로 직접 삽입해도
    실제 접근 판정에서는 여전히 차단된다 — UI 비노출로만 끝내지 않고 서버단에서 강제 검증.

집행 위치:
  src/routes/cms/+layout.server.ts load() — hasRouteAccess()로 기본 필터 후, cms_menu_permissions
  테이블에서 그 계정의 allowed=false 오버레이를 읽어 교집합 적용(빼기 전용). 이 결과가 실제
  GNB에 렌더링되는 메뉴 목록이다.

메뉴 목록 SSOT:
  src/lib/constants/cmsMenus.ts — 서브메뉴 ~25개의 menu_key 목록. GNB 렌더링과 AccountDetailPanel
  "권한설정" 탭 권한 그리드가 이 파일을 동일하게 재사용한다(이중 하드코딩 없음).

API:
  GET/PUT /api/cms/accounts/[id]/menu-permissions — service_role 경유 (CMS 브라우저 auth 패턴 준수).
  CRUD RPC: cms_get_menu_permissions / cms_upsert_menu_permission / cms_delete_menu_permission
  (Migration #352) — 전부 SECURITY DEFINER + service_role 전용.

감사 연동:
  PUT 성공 시 cms_admin_audit_log에 menu_permission_change 이벤트를 자동 기록.
```

### CMS 관리자 감사로그 및 접속로그 (2026-08-26 확정)

```
1. cms_login_logs (Migration #326 — 기존 캡처 인프라)
   목적: 관리자의 로그인 성공 이벤트를 시간 순으로 기록 (보안 감사 + 접속 이상 탐지 용도).
   캡처 위치: src/routes/cms/login/+page.server.ts — 로그인 성공 시 자동 INSERT.
   컬럼: user_id / email / cms_role / ip_address / user_agent / logged_in_at
   RLS: 활성화 + 정책 없음 (service_role 전용 — 브라우저 직접 조회 불가).
   조회 API: /api/cms/accounts/[id]/login-logs — +server.ts + service_role 패턴 필수.
   표시 UI: AccountDetailPanel "접속로그" 탭 — 아이디/접속일시/IP/기기·브라우저(가공 표시) 4컬럼.
     * 브라우저·OS 가공 표시: src/lib/utils/parseUserAgent.ts (Chrome/Edge/Firefox/Safari × macOS/
       Windows/iOS/Android/Linux 조합) — 원문 User-Agent 문자열을 그대로 노출하지 않는다.

2. cms_admin_audit_log (Migration #353 — 2026-08-26 신규)
   목적: 관리자 계정 변경 이력을 append-only로 영구 보존 (권한 남용 추적 + 감사 증적 용도).
   설계 원칙: append-only — UPDATE/DELETE 없음. RLS 활성화 + 정책 없음 (service_role 전용).
   컬럼: user_id(액션 주체) / action_type / target_user_id / before_value(jsonb) /
         after_value(jsonb) / created_at.
   기록 대상 action_type (8종):
     role_change / create(superadmin 생성 시만) / delete / suspend / menu_permission_change
     (필수 5종 — TASK.md GATE C 체크리스트 기준)
     + concurrent_login_change / session_limit_change / name_change (추가 3종)
   공용 헬퍼: src/lib/server/cmsAdminAuditLog.ts — insertCmsAdminAuditLog(). fail-soft
     (INSERT 실패가 실제 관리 액션 실패로 이어지지 않도록 try/catch 흡수).
```

> ⚠️ `cms_login_logs`와 `cms_admin_audit_log`는 목적이 다르다 —
> `cms_login_logs`는 "언제 누가 로그인했는가"(접속 이력),
> `cms_admin_audit_log`는 "언제 누가 어떤 계정 설정을 바꿨는가"(변경 이력).
> 두 테이블 모두 service_role 전용이므로 +server.ts / +page.server.ts 경유 조회만 허용.

### ⛔ CMS 중앙 게이트 (hooks.server.ts) — /cms/** 변경 요청 (2026-09-25 신설)

```
폼 액션(POST)은 +layout.server.ts의 CMS 접근 가드를 거치지 않는다 → 로그인만 된 사용자(익명
고객 포함)가 액션에 직접 POST하면 액션 개별 역할 확인이 없는 경우 service_role로 상품 등을
변경할 수 있었다(sp3-qa 발견). 이를 막기 위해 src/hooks.server.ts handle()에 중앙 게이트를 둔다.

대상  : 메서드가 GET/HEAD/OPTIONS가 아니고 경로가 /cms 또는 /cms/* 인 요청
        (경로는 디코딩·이중슬래시 병합·소문자화 후 판정 — 끝슬래시·대소문자·%인코딩 우회 차단)
예외  : /cms/login, /cms/login/* (로그인 전 액션: login·복구·초대 비밀번호 설정). 그 외 예외 없음
        (cms 하위에 비로그인 POST 필요 지점 없음 — 전수 grep 확인)
판정  : 세션 없음 → 401 / 세션 있으나 cms_role 없음 → 403 (JSON {error}) / 어떤 cms_role이든 통과
        역할 조회는 getCmsRoleForAction(locals.cmsRole 캐시), 조회 예외 시 403(안전측)
        GET에는 추가 DB 조회 없음
세부  : partner/manager/superadmin 등급별 게이트는 각 액션이 그대로 담당(중앙 게이트는 "최소
        CMS 직원 여부"만 보장). 액션에 개별 역할 확인이 없어도 비CMS 사용자는 도달 불가.
범위  : /api/cms/* 는 hooks 게이트 대상이 아니다 — 각 +server.ts가 자체 게이트를 가져야 한다
        (/api/cms/upload는 고객 크레이지로그 첨부 'log/' 경로만 비CMS 허용).
테스트: src/__tests__/security/cmsRoleGate.test.ts · cmsApiRoleGate.test.ts
```

### ⛔ form action에서 locals.cmsRole 직접 사용 절대 금지 (2026-07-23)

```
SvelteKit form action POST 시 +layout.server.ts:load는 액션 실행 이후에 실행됨.
→ form action 실행 시점에 locals.cmsRole = undefined (항상)
→ !locals.cmsRole = !undefined = true → 모든 역할 차단

❌ 금지 패턴 (버그 유발)
if (!session || !locals.cmsRole) return fail(401, ...)
if (!hasSettingsAccess(locals.cmsRole ?? '')) return fail(403, ...)

✅ 올바른 패턴 — getCmsRoleForAction() 헬퍼 필수
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

const { session } = await locals.safeGetSession()
if (!session) return fail(401, { error: '인증 필요' })
const cmsRole = await getCmsRoleForAction(locals)
if (!cmsRole) return fail(403, { error: '권한 없음' })

// manager 이상 체크가 필요한 경우
if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })
```

```typescript
// src/lib/server/getCmsRoleForAction.ts
// locals.cmsRole 설정됐으면 반환, 미설정이면 DB 직접 조회 + 캐싱
export async function getCmsRoleForAction(locals: App.Locals): Promise<string | null>
```

> load 함수에서는 `const { cmsRole } = await parent()` 사용 — 변경 없음.
> form action에서만 getCmsRoleForAction() 사용.

---

## 환경변수 분리 (절대 준수)

```typescript
// ✅ 서버 전용 (클라이언트 번들 불포함)
import { TOSS_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'

// ✅ 클라이언트 공개 (PUBLIC_ 접두사 필수)
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

// ❌ 금지 — 서버 키를 public import
import { TOSS_SECRET_KEY } from '$env/static/public'  // Husky 자동 차단
```

---

## SQL Injection 방지

```typescript
// ✅ RPC 파라미터화 (안전)
await supabase.rpc('get_user_reservations', {
  p_user_id: userId,
  p_status: status
})

// ✅ Supabase 빌더 (자동 파라미터화)
await supabase.from('products').select('*').eq('id', productId)

// ❌ 금지 — 문자열 직접 삽입
await supabase.rpc('custom_query', {
  sql: `SELECT * FROM products WHERE name = '${userInput}'`
})
```

---

## 입력 검증 원칙

```
서버사이드 검증 필수 (클라이언트 검증은 UX 보조용)
날짜 형식 : YYYY-MM-DD (정규식 또는 Date 파싱 검증)
UUID : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
금액 : 양수 정수 (소수점 없음, 최대값 제한)
문자열 : 최대 길이 제한 + XSS 방지 (svelte auto-escaping)
```

---

## 웹훅 서명 검증

```typescript
import { createHmac } from 'crypto'

function verifyTossSignature(body: unknown, signature: string | null): boolean {
  if (!signature) return false

  const { TOSS_SECRET_KEY } = // $env/static/private
  const computed = createHmac('sha256', TOSS_SECRET_KEY)
    .update(JSON.stringify(body))
    .digest('base64')

  return computed === signature
}
```

---

## GATE C 확인 항목 (보안 관련)

```
[ ] TOSS_SECRET_KEY / SERVICE_ROLE_KEY → $env/static/private 전용?
[ ] 클라이언트 번들에 서버 키 포함 안 됨? (빌드 후 검증)
[ ] 모든 보호 라우트에 세션 체크 있음?
[ ] RLS 정책 — 고객 A가 고객 B 데이터 못 보는가?
[ ] 웹훅 HMAC-SHA256 서명 검증 동작?
[ ] SQL Injection 위험 없음? (RPC 파라미터화 사용)
[ ] 서버사이드 입력 검증 존재?

[ ] [계정 관리] requireTrueSuperadmin()이 getRoleLevel===100(정확히 superadmin)만
    통과시키는가? (hasSettingsAccess=manager+와 혼동하지 않았는가)
[ ] [계정 관리] 대상이 superadmin인 액션(updateRole/toggleSuspend/delete/createAccount
    superadmin) 전부 requireTrueSuperadmin 분기가 적용됐는가? 일부만 고치고 누락 없는가?
[ ] [계정 관리] 마지막 남은 superadmin의 강등/삭제가 requireNotLastSuperadmin()으로
    차단되는가?
[ ] [메뉴권한] cms_menu_permissions 오버레이가 role 허용 범위를 넘어서는 확장을 서버단에서
    차단하는가? (클라이언트 조작으로 allowed=true 우회 불가 확인)
[ ] [메뉴권한] 조회/설정 API가 +server.ts + service_role 패턴을 따르는가? (브라우저 직접 RLS 조회 금지)
[ ] [접속로그] 조회 API가 본인 또는 manager+ 호출자만 허용하는가?
[ ] [접속로그] 기기·브라우저 컬럼이 parseUserAgent.ts로 가공 표시되는가? (원문 UA 노출 금지)
[ ] [감사로그] cms_admin_audit_log가 append-only인가? (UPDATE/DELETE 없음)
[ ] [감사로그] insertCmsAdminAuditLog 헬퍼가 fail-soft로 래핑됐는가? (INSERT 실패 → 주 액션 롤백 안 됨)
[ ] [중앙 게이트] hooks.server.ts의 /cms/** 변경 요청 게이트가 유지되는가? 예외가 /cms/login뿐인가? (cmsRoleGate.test.ts)
[ ] [중앙 게이트] 신규 /api/cms/* +server.ts에 자체 세션+CMS 역할 게이트가 있는가? (hooks 게이트는 /api 미적용)
```

---

*security-auth.md v4.2 | Harness Flow v3.2 | 보안·인증·RLS·CMS 역할 | 2026-08-XX /cms/codes 20개 액션 전부 manager 이상(19개) + superadmin(transferCode) 게이트로 통일(QR-CASE-2), load() 페이지 진입 게이트 추가로 partner UI 노출 갭 해소 | 2026-08-11 Phase 7 — 전자계약 양식·발행·발송 5개 파일·9곳 manager 이상 게이트 확정 적용(P7-1~5), 접근 매트릭스 갱신(11개→5파일9곳으로 정정) | 2026-08-13 tiptap-doc 렌더링 회귀 수정(CRITICAL) | 2026-08-24 CMS 전역 정밀검증 v3 STAGE 6·3 반영 — 서명·직인 자산 관리 행의 스테일 "(P8B-2, 미구현)" 주석 제거(실제로는 구현·매트릭스 그대로 유효함을 코드 재확인), 구독 관리(`/cms/subscriptions`) 행 신규 추가(그동안 매트릭스에 아예 없던 신규 메뉴 문서 공백 해소) | 2026-08-25 상품 코드 재반영(`reassignCodeSeries`) 행 신규 추가(products.md §2-11, QA 지적으로 매트릭스 누락 해소) | 2026-08-26 계정 상세 관리 행 10개 신규 추가(계정 조회·수정·정지·삭제·등급변경·superadmin생성·메뉴권한·접속로그 각 행, requireTrueSuperadmin/requireNotLastSuperadmin 원칙 명문화) + "메뉴별 세부 접근권한(계정 오버레이 모델)" 신규 절 추가(cms_menu_permissions·좁히기 전용·집행 위치·API·감사 연동) + "CMS 관리자 감사로그 및 접속로그" 신규 절 추가(cms_login_logs 목적/캡처/RLS/가공표시, cms_admin_audit_log 목적/append-only/8종 이벤트/fail-soft 헬퍼) + GATE C 계정관리·메뉴권한·접속로그·감사로그 관련 9개 체크항목 추가 | 2026-08-26(같은 날 후속, QA Stage 9 블로킹 수정) "계정 이름·휴대번호 수정" 1행을 "계정 이름 수정"/"계정 휴대번호 수정" 2행으로 분리 — `updatePhone` 액션에만 옛 `requireSuperadmin()`이 남아있던 게이트 누락을 `requireAccountMutationAccess()`로 교체해 해소, 회귀 테스트 3건 추가 | 2026-08-26(같은 날 3차 후속) `/cms/rental/history` 행
신규 추가 — 계정관리 아젠다 Stage 0 조사 중 이 화면에 role 가드 자체가 없고 매트릭스에도
미등재였음이 발견됨(로그인만 되어 있으면 partner도 접근 가능한 상태). 이 화면은
`/cms/products` 상세패널 '이력' 탭과 동일 데이터(`product_history_records`)를 공유하므로
`/cms/products`가 이미 partner에게 세션만으로 허용하는 것과 동일 정책으로 확정(Stephen
확인) — 코드 변경 없음, 매트릭스 등재로 공백만 해소 | 2026-08-31 두발히어로 배송 API 행 신규 추가 — dhero 4개 핸들러(GET·POST·cancel PUT·return POST)가 세션 체크만 있고 등급 체크 없어 partner도 호출 가능하던 공백을 RSV-B-B6으로 `hasSettingsAccess(manager+)` 추가 + 매트릭스 등재 | 2026-09-15 Stephen 지시로 파트너 접근범위 3건 재조정 — 대여 설정(`/cms/set/rental`)을
role 기본값 단계에서 완전 차단(GNB 숨김+라우트 차단+액션 23곳 게이트 신설) / 고객목록
(`customers.list`) 열람은 파트너 기본 허용으로 전환(편집·삭제 액션은 그대로 manager+ 유지) /
GNB가 계정별 메뉴권한 오버라이드까지 반영해 서브메뉴 전부 차단된 대메뉴를 자동으로 숨기도록
`+layout.server.ts`·`+layout.svelte` 리팩터. `/api/cms/accounts/[id]/menu-permissions` PUT에
"슈퍼마스터 잠금"(슈퍼마스터가 OFF로 저장한 항목은 슈퍼마스터만 다시 ON 가능, 매니저 시도 시
전용 안내 메시지) 신규 추가. | 2026-09-15(같은 날 후속) CRITICAL 수정 — 위 API에 대상이
superadmin이면 호출자도 진짜 superadmin이어야 하는 `requireAccountMutationAccess()` 게이트가
처음부터 빠져 있어 매니저가 슈퍼마스터 계정의 메뉴 접근을 몰래 차단할 수 있던 공백 발견·해소
(다른 계정관리 액션과 동일 기준으로 통일), 회귀 테스트 2건 추가. | 2026-09-15(같은 날 3차 후속)
EC-5(자기 자신 대상 메뉴권한 변경 차단)에 슈퍼마스터 예외 추가 — 실사용 중 발견된 데드락(매니저가
유일한 슈퍼마스터의 권한을 OFF해둔 상태에서 본인도 되돌릴 방법이 없던 상태)을 계기로, 슈퍼마스터만
자기 자신을 대상으로 한 메뉴권한 변경도 허용(manager는 그대로 차단 유지), 회귀 테스트 1건 추가. |
2026-09-15(같은 날 4차 후속) 실사용 중 발견 — 매니저가 "본인" 계정의 슈퍼마스터-잠금 항목을
켜려 할 때 EC-5 검사가 슈퍼마스터 잠금 검사보다 먼저 실행돼 실제 사유가 가려지던 순서 문제
수정(잠금 검사를 EC-5보다 먼저 수행하도록 재배치), 회귀 테스트 1건 추가·기존 3건 갱신.*
