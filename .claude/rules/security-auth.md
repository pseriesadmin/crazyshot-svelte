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
| 관리자 서명·직인 자산 관리 | `/cms/set/signature` | ❌ | ✅ | ✅ |
| 대여 설정 | `/cms/set/rental` | ✅ 세션만 | ✅ | ✅ |
| 고객 관리 | `/cms/customers` | ❌ | ✅ | ✅ |
| 구독 관리 | `/cms/subscriptions`, `/cms/subscriptions/new` | ❌ | ✅ | ✅ |
| 프로모션 배너 | `/cms/promotion/ad` | ❌ | ✅ | ✅ |
| 프로모션 쿠폰 | `/cms/promotion/coupon` | ❌ | ✅ | ✅ |
| 프로모션 포인트 | `/cms/promotion/point` | ❌ | ✅ | ✅ |
| 계정 생성 | `/cms/accounts` | ❌ | ✅ | ✅ |
| 계정 목록·수정 | `/cms/accounts/list` | ❌ | ✅ | ✅ |
| 코드 이관 | `/cms/codes` → `transferCode` | ❌ | ❌ | ✅ |
| 코드설정 기타 전체(20개 액션 중 19개) | `/cms/codes` → `addCode`·`editCode`·`deleteCode`·`toggleActive`·`saveFormat`·`updateCodeRule`·`saveMapping`·`savePrefixCodes`·`addGroup`·`editGroup`·`deleteGroup`·`toggleGroupActive`·`toggleGroupProductFilter`·`toggleGroupPartnerType`·`addGroupItem`·`updateGroupItemSettings`·`removeGroupCombo`·`removeGroupItem`·`removeComboItem` | ❌ | ✅ | ✅ |
| 상품 코드 재반영(2026-08-25) | `/cms/products` → `reassignCodeSeries`(재고 0개 부모상품의 기준 품번 재할당, products.md §2-11) | ❌ | ✅ | ✅ |
| 계정 상세 조회 | `/cms/accounts/list` → `AccountDetailPanel` — 기본정보·권한설정·접속로그 탭 열람 | ❌ | ✅ | ✅ |
| 계정 이름 수정 | `/cms/accounts/list` → `updateName` | ❌ | ✅(대상이 partner/manager일 때) | ✅ |
| 계정 휴대번호 수정 | `/cms/accounts/list` → `updatePhone` | ❌ | ✅(대상이 partner/manager일 때) | ✅ |
| 계정 정지/복원 | `/cms/accounts/list` → `toggleSuspend` | ❌ | ✅(대상이 partner/manager일 때) | ✅ |
| 계정 삭제 | `/cms/accounts/list` → `delete` | ❌ | ✅(대상이 partner/manager일 때만 — 대상이 superadmin이면 차단) | ✅ |
| 관리자 등급(cms_role) 변경 | `/cms/accounts/list` → `updateRole` | ❌ | ❌(대상이 superadmin이거나 승격 대상이 superadmin이면 차단) | ✅ |
| superadmin 계정 신규 생성 | `/cms/accounts` → `createAccount` (newAccountRole='superadmin') | ❌ | ❌ | ✅ |
| 메뉴별 세부 접근권한 설정 | `/api/cms/accounts/[id]/menu-permissions` PUT | ❌ | ✅ | ✅ |
| 중복 로그인 허용 토글 | `/cms/accounts/list` → `toggleConcurrent` | ❌ | ✅ | ✅ |
| 세션 제한 토글 | `/cms/accounts/list` → `toggleSession` | ❌ | ✅ | ✅ |
| 접속로그 조회 | `/api/cms/accounts/[id]/login-logs` — 본인 계정 또는 manager+ | ❌(타인 조회) | ✅(본인·타인 모두) | ✅ |

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
```

---

*security-auth.md v4.1 | Harness Flow v3.2 | 보안·인증·RLS·CMS 역할 | 2026-08-XX /cms/codes 20개 액션 전부 manager 이상(19개) + superadmin(transferCode) 게이트로 통일(QR-CASE-2), load() 페이지 진입 게이트 추가로 partner UI 노출 갭 해소 | 2026-08-11 Phase 7 — 전자계약 양식·발행·발송 5개 파일·9곳 manager 이상 게이트 확정 적용(P7-1~5), 접근 매트릭스 갱신(11개→5파일9곳으로 정정) | 2026-08-13 tiptap-doc 렌더링 회귀 수정(CRITICAL) | 2026-08-24 CMS 전역 정밀검증 v3 STAGE 6·3 반영 — 서명·직인 자산 관리 행의 스테일 "(P8B-2, 미구현)" 주석 제거(실제로는 구현·매트릭스 그대로 유효함을 코드 재확인), 구독 관리(`/cms/subscriptions`) 행 신규 추가(그동안 매트릭스에 아예 없던 신규 메뉴 문서 공백 해소) | 2026-08-25 상품 코드 재반영(`reassignCodeSeries`) 행 신규 추가(products.md §2-11, QA 지적으로 매트릭스 누락 해소) | 2026-08-26 계정 상세 관리 행 10개 신규 추가(계정 조회·수정·정지·삭제·등급변경·superadmin생성·메뉴권한·접속로그 각 행, requireTrueSuperadmin/requireNotLastSuperadmin 원칙 명문화) + "메뉴별 세부 접근권한(계정 오버레이 모델)" 신규 절 추가(cms_menu_permissions·좁히기 전용·집행 위치·API·감사 연동) + "CMS 관리자 감사로그 및 접속로그" 신규 절 추가(cms_login_logs 목적/캡처/RLS/가공표시, cms_admin_audit_log 목적/append-only/8종 이벤트/fail-soft 헬퍼) + GATE C 계정관리·메뉴권한·접속로그·감사로그 관련 9개 체크항목 추가 | 2026-08-26(같은 날 후속, QA Stage 9 블로킹 수정) "계정 이름·휴대번호 수정" 1행을 "계정 이름 수정"/"계정 휴대번호 수정" 2행으로 분리 — `updatePhone` 액션에만 옛 `requireSuperadmin()`이 남아있던 게이트 누락을 `requireAccountMutationAccess()`로 교체해 해소, 회귀 테스트 3건 추가 | 2026-08-26(같은 날 3차 후속) `/cms/rental/history` 행
신규 추가 — 계정관리 아젠다 Stage 0 조사 중 이 화면에 role 가드 자체가 없고 매트릭스에도
미등재였음이 발견됨(로그인만 되어 있으면 partner도 접근 가능한 상태). 이 화면은
`/cms/products` 상세패널 '이력' 탭과 동일 데이터(`product_history_records`)를 공유하므로
`/cms/products`가 이미 partner에게 세션만으로 허용하는 것과 동일 정책으로 확정(Stephen
확인) — 코드 변경 없음, 매트릭스 등재로 공백만 해소*
