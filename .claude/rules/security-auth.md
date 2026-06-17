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

*security-auth.md v3.1 | Harness Flow v3.1 | 보안·인증·RLS*
