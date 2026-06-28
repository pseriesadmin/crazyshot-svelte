# 학습 기록: DB 마이그레이션·스키마 관련 중요 지침
# 작성일: 2026-06-28 | Harness Flow v3.2
# 원인: 2026-06-27 Cursor AI 충돌 복구 + 초대링크 기능 구현 세션 정리

---

## 1. 마이그레이션 파일 타임스탬프 ≠ DB 실제 적용 버전 (주의)

### 발생 경위
마이그레이션 49번 (`handle_new_user` 익명유저 수정)을 MCP `apply_migration`으로 먼저
Stage DB에 직접 적용한 뒤, 나중에 파일을 생성했다.

### 결과
| 구분 | 값 |
|------|-----|
| DB 실제 적용 버전 | `20260627151934` |
| 마이그레이션 파일명 타임스탬프 | `20260628010049` |
| 파일 경로 | `supabase/migrations/20260628010049_49_fix_handle_new_user_anon.sql` |

### 원칙 (재발 방지)
- **MCP `apply_migration` 실행과 파일 생성은 동시에** 수행할 것
- "파일 없이 MCP 적용" 상태는 추후 혼란 야기 → 즉시 파일 생성으로 동기화
- 파일 타임스탬프와 DB 버전이 다를 때 Supabase `list_migrations`로 반드시 실제 적용 순번 확인

---

## 2. `handle_new_user` 트리거 — 익명 유저(anon) 처리 (Migration 49 반영)

### 문제
채팅 게스트 사용자는 Supabase anon auth로 `auth.users`에 등록된다.
이때 `handle_new_user` 트리거가 `user_profiles.email NOT NULL` 제약에 걸려 **500 에러** 발생.

### 원인 코드 (수정 전)
```sql
INSERT INTO public.user_profiles (id, email)
VALUES (NEW.id, NEW.email)  -- 익명 유저: NEW.email = NULL → NOT NULL 위반
```

### 수정 코드 (현재 적용)
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_anonymous IS TRUE THEN
    RETURN NEW;  -- 익명 유저: user_profiles INSERT 스킵
  END IF;
  INSERT INTO public.user_profiles (id, email)
  VALUES (NEW.id, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
```

### 적용 상태
- Stage DB (`ezyvffjvuwmtuhpxdjrw`): ✅ 적용 완료 (2026-06-27)
- Production DB (`vnbpmvxruyciuuaermyh`): ⏳ 미적용 (스테이지 검증 후 배포 필요)

### 재발 방지
익명 유저 관련 테이블·트리거·RLS 작성 시 `NEW.is_anonymous IS TRUE` 분기 필수.
`user_profiles`는 **실명 인증 사용자 전용** 테이블. 익명 chat 세션은 `auth.uid()`를 직접 사용.

---

## 3. `admin_invite_tokens` 스키마 — CMS 초대링크 시스템

### 테이블 구조
```sql
admin_invite_tokens
  id          UUID PK
  token       TEXT UNIQUE NOT NULL        -- URL 파라미터 (?invite=)
  created_by  UUID FK → auth.users        -- 새로 생성된 미인증 관리자 UUID
  used_by     UUID FK → auth.users NULL
  used_at     TIMESTAMPTZ NULL
  expires_at  TIMESTAMPTZ NOT NULL
```

### 핵심 설계 원칙
- `created_by` = 계정 등록 시 생성된 **비밀번호 없는 auth.users UUID**
- 초대 링크 진입 → `created_by` 기준으로 비밀번호 설정 (`auth.admin.updateUserById`)
- 토큰 소비 시 `used_by = created_by`, `used_at = now()` 업데이트
- 만료·사용 여부: `used_at IS NOT NULL OR expires_at < now()`

### 초대 흐름 (확정)
```
1. /cms/accounts → createAccount 액션
   → auth.admin.createUser({ email, email_confirm: true })  [비밀번호 없음]
   → cms_create_invite_token RPC (p_created_by = 새 UUID)
   → 초대링크: /cms/login?invite={token}

2. /cms/login?invite={token}
   → 서버 load: 토큰 검증 → inviteMode: true, inviteEmail 반환
   → 만료/사용됨: inviteExpired: true 반환

3. setPassword 액션 제출
   → 토큰 재검증 (race condition 방지)
   → auth.admin.updateUserById(created_by, { password })
   → admin_invite_tokens UPDATE (used_by, used_at)
   → locals.supabase.auth.signInWithPassword({ email, password })
   → redirect(303, '/cms')
```

### 구현 파일
| 파일 | 역할 |
|------|------|
| `src/routes/cms/accounts/+page.svelte` | 등록 폼 → 성공 시 초대링크 정보 화면 전환 |
| `src/routes/cms/accounts/+page.server.ts` | createAccount 액션 (auth.admin.createUser + RPC) |
| `src/routes/cms/login/+page.server.ts` | load(토큰 검증) + setPassword 액션 |
| `src/routes/cms/login/+page.svelte` | 초대 모드/만료/일반 로그인 3분기 UI |

---

## 4. `supabase.ts` 클라이언트 — SSR/CSR 혼용 패턴 (복구 이력)

### 복구 배경
2026-06-27 Cursor AI가 `supabase.ts`를 손상시켜 `createBrowserClient` 제거 →
브라우저에서도 `createClient` 사용 → chat Realtime 401 에러.

### 올바른 패턴 (현재 코드)
```typescript
// src/lib/services/supabase.ts
import { browser } from '$app/environment'
import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export const supabase = browser
  ? createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
  : createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
```

### 구분 이유
| 클라이언트 | 세션 저장 방식 | 용도 |
|----------|-------------|------|
| `createBrowserClient` | 쿠키 기반 (SSR 공유) | 브라우저: 서버 세션 동기화 |
| `createClient` | 메모리 전용 | SSR: 세션 불필요 (서버에서 locals.supabase 사용) |

### 재발 방지
Cursor AI 또는 다른 도구가 `supabase.ts`를 수정했다면 위 패턴 준수 여부를 **최우선 점검**.
`createBrowserClient`가 사라지면 → 채팅 Realtime, 로그인 세션 쿠키 전부 깨짐.

---

## 5. CMS 서비스 Role 클라이언트 생성 패턴

### 서버 라우트에서 admin 작업 (비밀번호 설정 등)
```typescript
// +page.server.ts / +server.ts
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!)
// → auth.admin.* 사용 가능
```

### 필수 확인
- `SUPABASE_SERVICE_ROLE_KEY`는 반드시 `$env/dynamic/private` 또는 `$env/static/private`
- `$env/static/public` 절대 금지 (H-05 위반 → Husky 차단)
- `PUBLIC_SUPABASE_URL`은 `$env/static/public` 정상 (공개값)

---

## 6. ESLint `no-undef` — 브라우저 전역 API 참조 방법

### 문제
```typescript
// ❌ ESLint: 'navigator' is not defined
navigator.clipboard.writeText(text)
```

### 해결
```typescript
// ✅ window.navigator 경유 — ESLint no-undef 우회
window.navigator.clipboard.writeText(text)

// ✅ 반드시 browser 체크 후 사용
if (browser) {
  window.navigator.clipboard.writeText(text).catch(() => {})
}
```

---

## 7. 마이그레이션 필수 적용 순서 (재확인)

```
⛔ 절대 원칙:
  1단계: crazyshot-stage (ezyvffjvuwmtuhpxdjrw) 검증
  2단계: crazyshot (vnbpmvxruyciuuaermyh) 실배포

⚠️ apply_migration 실행 전 project_id 재확인 필수
⚠️ 기존 마이그레이션 파일 직접 수정 절대 금지 (새 파일 생성)
```

### 현재 Stage DB 미적용 마이그레이션
Migration 49 (`handle_new_user` anon 수정)은 Stage에만 적용됨.
Production 배포 전 Stephen 승인 후 `apply_migration` 실행 필요.

---

*migration_schema_2026-06-28.md | Harness 학습 기록 | 2026-06-28*
*참조 커밋: fed4fdb (Cursor 손상 복구), 7f3dd76 (초대링크 완성)*
