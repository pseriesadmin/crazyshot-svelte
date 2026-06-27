# core-rules.md — 크레이지샷 개발 실행 원칙
# Harness Flow v3.1 | 모든 에이전트가 공통 참조

---

## 스택 규칙

```
SvelteKit 5 (Svelte 5 Runes)
- 상태: $state() / $derived() / $effect() — writable store 사용 금지
- 컴포넌트 props: $props() 구문 사용
- 이벤트: onclick={handler} — on:click 구문 금지 (Svelte 4 문법)
- 타입: interface Props {}  + $props<Props>() 패턴

TypeScript
- any 타입 절대 금지 (H-06 ESLint 자동 차단)
- as unknown as T 캐스팅 → 대신 타입 가드 함수 작성
- 반환 타입 명시 필수 (함수 시그니처)

Supabase — DB 환경 분리 (절대 혼용 금지)
┌─────────────────────────────────────────────────────────────────────┐
│ 🔴 실서비스 DB  crazyshot (Production)                              │
│    ID : vnbpmvxruyciuuaermyh                                        │
│    URL: https://vnbpmvxruyciuuaermyh.supabase.co                   │
│    → .env.local 현재 연결. 검증 완료 마이그레이션만 적용            │
│                                                                     │
│ 🟡 테스트 DB   crazyshot-stage (Preview)                            │
│    ID : ezyvffjvuwmtuhpxdjrw                                        │
│    URL: https://ezyvffjvuwmtuhpxdjrw.supabase.co                   │
│    → 마이그레이션 1차 검증 전용                                     │
│                                                                     │
│ ⛔ 마이그레이션 필수 순서: crazyshot-stage 검증 → crazyshot 실배포  │
│ ⚠️ apply_migration 실행 전 project_id 반드시 재확인                │
│ ⚠️ 실서비스 DB 미검증 직접 적용 절대 금지                          │
└─────────────────────────────────────────────────────────────────────┘
- 클라이언트: import { supabase } from '$lib/services/supabase'
- 서버사이드: import { createServerClient } from '@supabase/ssr'
- RPC 호출: supabase.rpc('function_name', { params })
- 직접 DML(INSERT/UPDATE/DELETE) 금지 — RPC 경유만 허용 (H-01)

환경변수
- 클라이언트 공개: $env/static/public (PUBLIC_ 접두사만)
- 서버 전용: $env/static/private (절대 클라이언트 노출 금지 — H-05)
- 런타임 서버: $env/dynamic/private
```

---

## 파일 경로 규칙

```
서버 전용 로직    : src/routes/**/+page.server.ts, +server.ts
공유 가능 로직    : src/routes/**/+page.ts
도메인 서비스     : src/lib/services/{module}.ts
UI 컴포넌트      : src/lib/components/{category}/{Name}.svelte
타입 정의        : src/lib/types/{domain}.ts (database.ts는 생성 파일)
유틸             : src/lib/utils/{name}.ts
테스트           : src/__tests__/{module}.test.ts
```

---

## 코드 품질 기준

```
console.log  : 금지 (GATE C 전 전수 제거)
TODO/FIXME   : TASK.md BACKLOG 등록 후 코드에서 제거
에러 핸들링  : catch 블록 전부 명시적 처리 (빈 catch 금지)
N+1 쿼리     : 금지 — 단일 RPC 또는 .select('*, related(*)')로 조인
Realtime     : onDestroy 또는 $effect cleanup에서 .unsubscribe() 필수
```

---

## 30초 규칙

> 실행 전 반드시 묻는 것:
> 1. 이 코드가 TDD 도메인인가? (AGENTS.md 키워드 대조)
> 2. 범위 밖 파일을 건드리는가?
> 3. 기존 마이그레이션 파일을 수정하는가?
>
> 하나라도 "예" → 멈추고 Stephen 확인

---

*core-rules.md v3.1 | Harness Flow v3.1*
