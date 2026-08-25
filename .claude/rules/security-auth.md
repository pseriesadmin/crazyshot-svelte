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
```

---

*security-auth.md v3.9 | Harness Flow v3.2 | 보안·인증·RLS·CMS 역할 | 2026-08-XX /cms/codes 20개 액션 전부 manager 이상(19개) + superadmin(transferCode) 게이트로 통일(QR-CASE-2), load() 페이지 진입 게이트 추가로 partner UI 노출 갭 해소 | 2026-08-11 Phase 7 — 전자계약 양식·발행·발송 5개 파일·9곳 manager 이상 게이트 확정 적용(P7-1~5), 접근 매트릭스 갱신(11개→5파일9곳으로 정정) | 2026-08-13 tiptap-doc 렌더링 회귀 수정(CRITICAL) | 2026-08-24 CMS 전역 정밀검증 v3 STAGE 6·3 반영 — 서명·직인 자산 관리 행의 스테일 "(P8B-2, 미구현)" 주석 제거(실제로는 구현·매트릭스 그대로 유효함을 코드 재확인), 구독 관리(`/cms/subscriptions`) 행 신규 추가(그동안 매트릭스에 아예 없던 신규 메뉴 문서 공백 해소) | 2026-08-25 상품 코드 재반영(`reassignCodeSeries`) 행 신규 추가(products.md §2-11, QA 지적으로 매트릭스 누락 해소)*
