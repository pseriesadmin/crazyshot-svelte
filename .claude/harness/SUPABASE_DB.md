# SUPABASE_DB.md — Supabase DB 환경 정보
# Harness Flow v3.2 | 최종 업데이트: 2026-06-28

---

## DB 환경 요약

| DB | Project ID | URL | 연결 환경 |
|----|-----------|-----|---------|
| **crazyshot-stage** (Stage) | `ezyvffjvuwmtuhpxdjrw` | https://ezyvffjvuwmtuhpxdjrw.supabase.co | 로컬 개발 · Vercel Preview · stage.crazyshot.kr |
| **crazyshot** (Production) | `vnbpmvxruyciuuaermyh` | https://vnbpmvxruyciuuaermyh.supabase.co | Vercel Production only |

---

## 마이그레이션 적용 원칙 (절대 준수)

```
⛔ 필수 순서:
  1단계 → crazyshot-stage (ezyvffjvuwmtuhpxdjrw) 검증
  2단계 → crazyshot (vnbpmvxruyciuuaermyh) 실배포

⚠️ apply_migration 실행 전 project_id 반드시 재확인
⚠️ 기존 마이그레이션 파일 직접 수정 절대 금지 → 새 파일 생성만 허용
⚠️ 파일 생성과 MCP apply_migration은 반드시 동시에 (순서 어긋나면 타임스탬프 불일치 발생)
```

---

## 마이그레이션 적용 현황 (2026-06-28 기준)

| 번호 | 파일명 | Stage | Production | 내용 |
|------|--------|-------|-----------|------|
| 001~005 | initial_schema ~ seed | ✅ | ✅ | 기초 스키마·RLS·RPC·시드 |
| 006 | products seed | ✅ | ✅ | 상품 8개·자산 9개 |
| 007~048 | (중간 마이그레이션) | ✅ | ✅ | 채팅·예약·결제·CMS 관련 |
| **049** | `20260628010049_49_fix_handle_new_user_anon.sql` | ✅ | ⏳ **미적용** | 익명유저 트리거 500 수정 |

> ⚠️ **Migration 49**: Stage DB 적용 버전 `20260627151934` / 파일 타임스탬프 `20260628010049` — 불일치 있음 (MCP 먼저 적용 후 파일 생성). Production 배포 전 Stephen 승인 필요.

---

## 핵심 DB 설계 참조

### chat 관련 테이블 (PRD.1.7)
```
chat_sessions    → 세션 (open/pending/closed)
chat_messages    → 메시지 (user/admin/ai)
chat_intent_logs → Claude AI 의도 분류 로그
cs_records       → CS 기록
```
- `REPLICA IDENTITY FULL` 필수: `chat_messages`, `chat_sessions` (UPDATE Realtime 작동 조건)
- `auto_pending_inactive_sessions()` RPC: 1시간 비활성 open → pending 자동 전환

### CMS 초대링크 테이블
```
admin_invite_tokens
  created_by UUID → auth.users (새로 생성된 비밀번호 없는 관리자 UUID)
  token TEXT UNIQUE → URL ?invite= 파라미터
  expires_at / used_at / used_by
```

### 주요 RPC 함수
```sql
-- 예약
atomic_reserve_asset(p_product_id, p_asset_id, p_user_id, p_start_date, p_end_date, p_idempotency_key)
check_asset_availability(p_product_id, p_start_date, p_end_date)

-- 결제
calculate_cart_total(p_user_id, p_reservation_ids, p_coupon_code?, p_points_to_use?)
processPaymentAndCreateOrder(p_payment_key, p_order_id, p_amount, p_idempotency_key)

-- CMS
cms_create_invite_token(p_created_by UUID)
is_cms_user() → BOOLEAN (SECURITY DEFINER)

-- 채팅
auto_pending_inactive_sessions()
```

---

## Supabase 클라이언트 패턴

### 브라우저 (SvelteKit 클라이언트 사이드)
```typescript
// src/lib/services/supabase.ts — browser 분기 필수
import { browser } from '$app/environment'
import { createBrowserClient } from '@supabase/ssr'   // 쿠키 기반 세션
import { createClient } from '@supabase/supabase-js'  // SSR용 메모리 세션

export const supabase = browser
  ? createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  : createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
```

### 서버 (service_role 작업 — admin API)
```typescript
// +page.server.ts / +server.ts
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!)
// 사용: auth.admin.createUser(), auth.admin.updateUserById(), from().insert() 등
```

### 서버 (일반 인증 작업 — hooks.server.ts 경유)
```typescript
// +page.server.ts / +server.ts
export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  // locals.supabase → 이미 인증된 서버사이드 클라이언트
}
```

---

## RLS 핵심 정책

```sql
-- 사용자: 자신의 데이터만
rental_reservations: auth.uid() = user_id

-- CMS 관리자: is_cms_user() 함수 (SECURITY DEFINER)
SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id=auth.uid() AND cms_role IS NOT NULL)

-- 채팅: 참여자 접근
chat_messages SELECT: is_cms_user() OR session.user_id = auth.uid() OR session.admin_id = auth.uid()
```

---

## 이슈 이력 (재발 방지)

### [2026-06-27] handle_new_user anon 500 에러
- **원인**: 익명 유저(chat 게스트) 가입 시 `user_profiles.email NOT NULL` 위반
- **수정**: Migration 49 — `IF NEW.is_anonymous IS TRUE THEN RETURN NEW`
- **상태**: Stage ✅ / Production ⏳

### [2026-06-27] Cursor AI 손상 — supabase.ts createBrowserClient 제거
- **원인**: Cursor AI가 `createBrowserClient`를 `createClient`로 대체
- **증상**: 채팅 Realtime 401, 쿠키 세션 미동기화
- **복구**: `browser` 분기 + `createBrowserClient` 복원 (커밋 `fed4fdb`)
- **방지**: Cursor AI가 supabase.ts 수정 시 browser 분기 패턴 최우선 확인

### [2026-06-27] API 라우트 5개 URL 손상
- **원인**: Cursor AI가 `PUBLIC_SUPABASE_URL` → 하드코딩 URL로 변경
- **파일**: `/api/chat/session`, `/message`, `/admin-reply`, `/admin-attachment`, `/sessions`
- **복구**: 전부 `PUBLIC_SUPABASE_URL` 원복 (커밋 `fed4fdb`)

---

*SUPABASE_DB.md | Harness Flow v3.2 | 2026-06-28 업데이트*
*관련 학습: .claude/harness/learnings/migration_schema_2026-06-28.md*
