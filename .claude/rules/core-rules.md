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

⛔ $state(prop) 초기화 절대 금지 규칙 (2026-07-07 영구 등록)
  문제: $state()는 컴포넌트 마운트 시 1회만 실행됨.
        prop이 바뀌어도 $state 값은 첫 번째 값에 고정 → 다른 데이터인데 같은 UI 표시.

  ❌ 금지 패턴
    let local = $state(product.name)       ← prop 변경 시 stale
    let local = $state(priceRules.find(…)) ← prop 변경 시 stale

  ✅ 올바른 패턴 1 — 같은 페이지에서 다른 데이터를 같은 컴포넌트로 표시할 때
    부모에서 {#key uniqueId} 로 컴포넌트 감싸기 → prop 변경 시 완전 재마운트
    예) {#key data.selectedId}<ProductDetailPanel .../>{/key}

  ✅ 올바른 패턴 2 — prop 변경을 실시간 동기화해야 할 때 (캘린더 등)
    $effect(() => { localState = prop.value })  ← prop 추적 후 localState 갱신

  적용 대상:
    - 목록에서 항목 선택 시 같은 컴포넌트에 다른 데이터 표시하는 모든 패널·뷰어
    - prop으로 받은 초기값으로 $state를 초기화하는 모든 컴포넌트

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

## CSS 레이아웃 충돌 주의사항 (필수 숙지)

### ⚠️ CSS transform + position:fixed 충돌

```
transform이 적용된 조상 요소는 새로운 stacking context를 생성.
그 내부의 position:fixed 자식은 뷰포트가 아닌 transform 요소 기준으로 배치됨.
→ 모달·바텀시트·드롭다운 등 fixed 레이어가 왜곡되어 표시됨.

발생 시나리오:
  - FloatingBar peek 애니메이션(translateX) 도중 채팅 바텀시트 열기
  - 슬라이드 패널(transform) 내부의 fixed 알림 레이어

해결 원칙:
  - transform 활성 상태에서는 fixed 모달 진입을 pointer-events:none으로 차단
  - transform 해제 후에만 모달 열기 허용
```

### GNB position 원칙

```
GNB는 항상 position: fixed — sticky 금지
이유: sticky는 레이아웃 공간을 점유 → 콘텐츠 시작 위치가 GNB 높이만큼 밀림
     피그마 시안: GNB가 히어로 콘텐츠 위 오버레이 (별도 영역 없음)
```

---

## ⛔⛔⛔ 요청 범위 외 수정 절대 금지 (최우선 원칙 — 모든 작업의 기본값)

```
요청에 명시된 파일·기능만 수정한다. 그 외는 읽기(Read)만 허용.

✅ 허용: 요청 파일 수정, 의존성 파악을 위한 읽기
❌ 금지: 요청에 없는 파일 수정, "함께 고치면 좋을 것 같아서" 추가 수정
❌ 금지: 관련 있어 보이는 코드 리팩터링, 스타일 정리, 주석 추가

범위 외 수정이 반드시 필요하다고 판단될 경우:
  → 수정 전 Stephen에게 이유와 대상 파일 명시 후 확인 받을 것
  → 확인 없이 선수정 후 보고 금지
```

---

## Frozen 파일 목록 (변경 시 CRITICAL + Claude 세션 필수)

```
src/lib/services/supabase.ts       ← auth baseline: fed4fdb (createBrowserClient 패턴)
src/hooks.server.ts                ← 서버 세션 초기화
src/lib/env/supabasePublic.ts      ← env 래퍼
src/lib/stores/auth.ts             ← 인증 상태 스토어
src/routes/api/**/*                ← API 라우트 전체
supabase/migrations/**             ← 신규 ADD만 허용 (GP-10)
$env import가 있는 모든 파일
```

Cursor 측 차단 규칙: `.cursor/rules/domain-frozen-boundary.mdc`
Claude Code도 위 파일 변경 시 → GATE C 필수

---

## 30초 규칙

> 실행 전 반드시 묻는 것:
> 1. 이 코드가 TDD 도메인인가? (AGENTS.md 키워드 대조)
> 2. 범위 밖 파일을 건드리는가?
> 3. 기존 마이그레이션 파일을 수정하는가?
> 4. frozen 파일 목록에 있는 파일인가?
>
> 하나라도 "예" → 멈추고 Stephen 확인

---

*core-rules.md v3.2 | Harness Flow v3.2 | 2026-06-28 frozen boundary 추가*
