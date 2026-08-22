# AGENTS.md — 크레이지샷 (Crazyshot)
# Harness Flow v3.2 | 시범서비스 오픈 목표 W1~W12
# "자동이 막고, 사람이 방향을 잡는다."

---

## 프로젝트 정체성

```
서비스명   : 크레이지샷 (crazyshot.kr)
성격       : 촬영장비 전문 렌탈 플랫폼 (B2C + 글로벌 K-POP 팬층)
목표       : 시범서비스 오픈 (W1~W12, 3개월)
개발방식   : 1인 AI 에이전틱 코딩 | Claude Code | Harness Flow v3.2
스택       : SvelteKit + TypeScript · Supabase · Vercel · 토스페이먼츠 v2
```

---

## 황금 원칙

```
GP-1.  ⛔⛔⛔ git 쓰기 명령어(add / commit / push / merge / rebase 등)는 Stephen만 직접 실행 —
         AI는 절대 스스로 실행 금지. Stephen이 "커밋 메시지 제안해줘" "터미널 명령 알려줘"라고
         요청해도 이는 텍스트 제안 요청이지 실행 승인이 아니다 — 반드시 코드블록으로 제안만
         하고 실행은 하지 않는다. 병렬 세션 환경에서 승인 없는 커밋은 다른 세션의 작업과
         충돌·유실을 유발하는 CRITICAL 오류로 간주한다(2026-08-19 실사고 확인).
         .claude/settings.local.json에 git 쓰기 명령을 자동승인(allow) 패턴으로 추가하는 것도
         이 원칙 위반이다 — 발견 즉시 제거.
GP-2.  GATE 등급별 승인 분리:
         CRITICAL → Stephen 명시적 승인 필수 (GATE B·C·E)
         BOUNDARY → 자동 진행, 완료 1줄 보고 (Stephen 응답 불필요)
         ROUTINE  → 자동 진행, 결과 보고만
GP-3.  AI는 제안·실행, 결정은 Stephen
GP-4.  TDD 도메인은 테스트 없이 구현 코드 작성 금지
GP-5.  30분 초과 GSD / 15분 초과 TDD 태스크는 분해 후 재승인
GP-6.  불확실하면 즉시 멈추고 Stephen에게 질문 (단, ROUTINE 등급은 자율 진행)
GP-7.  명시 범위 밖 기능 선제 구현 금지 (Default-Exclude 원칙)
GP-11. GATE는 CRITICAL 등급만 발동 — ROUTINE·BOUNDARY는 자율 처리
GP-12. GATE 질문은 서비스 의도 언어로 — 기술 용어 Stephen에게 노출 금지
GP-13. 오인 발생 시 HOOK-7 즉시 실행 → misidentifications.md 기록 필수
GP-8.  컨텍스트 리셋 요청 시 TASK.md + GSD_LOG.md 즉시 재로드
GP-9.  서버 전용 키는 절대 클라이언트 코드에 노출 금지
GP-10. 기존 마이그레이션 파일 직접 수정 금지 (새 파일로 ALTER 처리)
```

---

## TDD 강제 도메인

아래 키워드가 아젠다에 포함되면 무조건 TDD 경로, 15분 단위 분해.

```
결제·정산   : payment / 결제 / 환불 / 보증금 / 토스 / 웹훅 /
              idempotency / 혼합결제 / 쿠폰 / 포인트 / 정산 / VAT

예약·재고   : reservation / 예약 / 가용성 / 이중예약 /
              atomic_reserve / 임시점유 / HOLD / 재고

핵심 RPC    : calculate_cart_total / atomic_reserve_asset /
              batch_atomic_reserve / check_delivery_deadline /
              subscribe_plan / cancel_subscription / get_credit_score

보안·권한   : auth / RLS / JWT / 인증 / 접근제어

특화 로직   : 크레이지스코어 / 할인순서 / 9단계 / canProceed /
              calc_at / Vision Agent / confidence
```

---

## GSD 도메인

```
UI·화면     : UI / 컴포넌트 / 화면 / 레이아웃 / 스타일
데이터관리  : CRUD / 목록 / 등록 / 수정 / 삭제 / 조회
사용자관련  : 회원정보 / 마이페이지 / 프로필 / 설정
커뮤니케이션: 알림 / 푸시 / 이메일
```

---

## 구현 전 자가점검 프로토콜 (GATE 0 — v3.2 신규)

> 목적: 요구사항 오해·규칙 미확인으로 인한 반복 수정(재작업 라운드)과 그로 인한 토큰 낭비,
> 그리고 규칙 위반으로 인한 심각한 결함(CRITICAL 오류)을 코드를 쓰기 **전에** 차단한다.
> CRITICAL/BOUNDARY/ROUTINE 등급과 무관하게 전 태스크에 적용 — 등급은 "Stephen 승인이
> 필요한가"만 가르고, "규칙을 먼저 확인했는가"는 항상 필수다. Edit/Write 호출 전 아래
> 4단계를 통과한다.

### 1단계 — 요구사항 명확성 확인 (추측 구현 금지)

```
아래 중 하나라도 해당하면 구현을 시작하지 말고 Stephen에게 먼저 확인한다(Error Taxonomy Class C):
□ 수정 범위가 "이 파일만"인지 "관련 파일도 포함"인지 요청문에서 특정되지 않음
□ 상태값·버튼 텍스트·전환 조건·수치 등 구체적 스펙이 요청에 없어 임의로 채워야 함
□ 기존 확정 정책(.claude/rules/*.md, rules-ref/*.md)과 충돌하는 것처럼 보임
□ "함께 고치면 좋을 것 같은" 범위 외 파일이 눈에 띔 (core-rules.md 최우선 원칙 — Read만 허용)

추측으로 구현 후 나중에 틀렸다고 보고받는 것보다, 구현 전에 1회 질문하는 것이 항상 더 저렴하다.
```

### 2단계 — 관련 도메인 규칙 선(先) 로드 (키워드 → 파일 자동 매핑)

```
요청 키워드                       → 확인/로드해야 할 파일
─────────────────────────────────────────────────────────────
예약·가용성·HOLD                  → @.claude/rules-ref/rental.md
대여상태·버튼·스텝퍼              → .claude/rules/rental-lifecycle.md (상시로드 — 재확인)
전자계약·서명                     → @.claude/rules-ref/contract.md
결제·웹훅·환불·정산               → @.claude/rules-ref/payment.md
채팅·세션·Realtime                → @.claude/rules-ref/chat.md
자연어검색·NLSearch·상품매칭       → @.claude/rules-ref/nlsearch.md
CMS 화면 UI                       → @.claude/rules-ref/cms-uiux.md
USER 화면 UI                      → @.claude/rules-ref/front-uiux.md
디자인 토큰(컬러·반경·타이포)       → .claude/rules/uiux-index.md 먼저 → 필요 시 @.claude/rules-ref/uiux.md
Figma → 코드 변환                 → @.claude/rules-ref/figma-publishing.md
plannode JSON 수정                → @.claude/rules-ref/plannode-update.md
상품·품번(product_code)·QR·재고    → .claude/rules/products.md (상시로드 — 재확인)
front↔cms 상호운영 로직            → .claude/rules/service-operations.md (상시로드 — 재확인)
인증·RLS·CMS 역할게이트            → .claude/rules/security-auth.md (상시로드 — 재확인)
git 명령 실행 요청                 → AGENTS.md GP-1 (텍스트 제안만, 실행 금지)

→ @ 표시 파일은 이번 세션에서 아직 Read하지 않았다면 코드를 쓰기 전에 반드시 먼저 Read한다.
→ 두 개 이상 도메인이 겹치면(예: 예약 상태 변경 + 채팅 알림 자동발송) 해당 파일 전부 로드한다.
→ 상시로드 파일(core-rules·security-auth·ui-mobile·uiux-index·rental-lifecycle·products·
  service-operations)은 이미 컨텍스트에 있어도 "읽었으니 안다"로 넘기지 말고, 이번 요청과
  직접 관련된 절(section)을 다시 짚어 확인한다 — 특히 GATE C 체크리스트.
```

### 3단계 — 구현 직전 내부 자문 (출력 불필요, 스스로 확인만)

```
□ 이번 변경이 2단계에서 로드한 규칙 파일의 GATE C 체크리스트 항목과 충돌하지 않는가?
□ $state(prop) 초기화 금지·Svelte 4 문법(on:event) 금지 등 core-rules.md 금지 패턴 위반 없는가?
□ 요청 범위 밖 파일을 수정하려는 게 아닌가? (Read는 허용, Edit/Write는 범위 내만)
□ git 쓰기 명령(add/commit/push 등)을 스스로 실행하려는 게 아닌가? (GP-1)
□ CMS 역할게이트·품번 영구고정·대여상태머신 등 CRITICAL 규칙과 충돌하지 않는가?
□ 과거 이 프로젝트에서 반복됐던 실패 패턴(아래)에 해당하지 않는가?
```

### 반복 발생한 실패 패턴 — 구현 전 마지막으로 대조 (학습된 사고 이력)

```
□ prop 값으로 $state 초기화 → 재마운트 없이 stale 데이터 표시 (core-rules.md)
□ product_code를 부모에 채번하거나 재발급 기능 신설 (products.md §2-1·§2-2)
□ product_code 조회에 .eq(toUpperCase()) 사용 — .ilike() 아니면 소문자 채번과 매칭 실패 (products.md QR-CASE-1)
□ form action에서 locals.cmsRole 직접 사용 — 항상 undefined라 전원 차단됨 (security-auth.md)
□ 새 알림 타입 추가 시 채팅카드(RPC)만 넣고 브라우저 푸시(push.ts) 동기화 누락 (service-operations.md §15)
□ 주문 연결(order_id) 생성 지점을 장바구니 체크아웃 제출 외 다른 곳에 추가 (service-operations.md §4)
□ 관리자 발신 채팅 알림에서 공유 RPC(find_or_create_general_chat_session) 대신 자체 세션조회 재구현 (service-operations.md §11)
□ transform 적용된 조상 내부에 position:fixed 모달을 그대로 중첩 (core-rules.md CSS 충돌 규칙)
□ npm run check가 svelte-check임을 모르고 tsc 기준으로만 판단 — .svelte Props 타입 불일치 누락
□ git 쓰기 명령을 "제안 요청"을 "실행 승인"으로 오인 (GP-1)
```

### 4단계 — 구현 후 즉시 재대조 (재작업 예방)

```
Edit/Write 완료 직후:
1. 방금 로드한 규칙 파일의 "GATE C 확인 항목"을 다시 훑어 위반이 있으면 그 자리에서 즉시 수정한다
   — Stephen이 지적하기 전에 스스로 잡는 것이 재작업 라운드를 없애는 유일한 방법이다.
2. npm run check(svelte-check) 결과 에러 0건을 확인하지 않고는 "완료"로 보고하지 않는다.
3. 수정한 파일 목록이 요청 범위와 정확히 일치하는지 최종 확인한다(범위 외 파일 混入 금지).
```

---

## 에이전트 호출 순서 (v3.2: 5계층 아키텍처 + 자동화 최적화)

> ⚠️ 에이전트 호출 원칙:
> - 하네스 플로우 계획 = 반드시 @promptor 또는 @harness-executor 사용
> - Claude 네이티브 Plan 에이전트 = 하네스 플로우 외 단순 질문용만 허용
>   (Plan 에이전트를 B-START 플래닝에 사용하면 TASK.md·GATE 구조가 생성되지 않음)
> - 작업 추적 = 반드시 .claude/harness/TASK.md 파일 직접 편집
>   (Claude Code 네이티브 TaskCreate/TaskUpdate 도구 사용 금지 — TASK.md와 이중 추적 충돌)

### 전체 워크플로우

```
[B-START] 아젠다 작성                    👤 Stephen
          ↓
LAYER 1: Context          →              🤖 @harness-executor (Planner)
         (AGENTS.md 로드 + TASK.md 생성)
          ↓
GATE B  조건부 발동:
  CRITICAL 아젠다 → 👤 Stephen 승인 필수
  GSD/ROUTINE     → ⚡ 자동 통과, 즉시 실행
          ↓
LAYER 2-4: 도메인 판별 + 실행            🤖
      GSD → @harness-executor (Generator) 직접 실행
          ↓ Self-Correction Runner (npm run check → 3회 자동 수정)
      TDD → @sp2-tdd-agents RED→GREEN→REFACTOR
          ↓ GATE C [RED][GREEN]: CRITICAL → 👤 Stephen / REFACTOR → 자동
          ↓
GATE C (CRITICAL 태스크만)              👤 Stephen 승인
BOUNDARY·ROUTINE 태스크                 ⚡ 자동 완료 보고 후 진행
          ↓
모든 NOW 완료 → @sp3-qa-agent 자동 호출  🤖 3단계 검수
          ↓
GATE E  최종 품질 승인                  👤 Stephen
          ↓
commit/push                             👤 Stephen (git 권한 전용)
          ↓
@sp4-deploy-agent (체크리스트)          🤖
```

### 대형 아젠다 경로 (선택)

```
@promptor → TASK.md 생성 (분석) → GATE B → @harness-executor 실행
```

---

## 절대 금지 패턴

```typescript
// ❌ 직접 INSERT (이중예약 위험) — H-01 자동 차단
await supabase.from('rental_reservations').insert({...})
// ✅ await supabase.rpc('atomic_reserve_asset', {...})

// ❌ 클라이언트 가격 계산 (조작 위험)
const price = basePrice * 0.9;
// ✅ await supabase.rpc('calculate_cart_total', {...})

// ❌ 재고 확인 없이 결제창 오픈
toss.requestPayment({...})
// ✅ atomic_reserve_asset → 성공 확인 → requestPayment

// ❌ 웹훅 수신 후 동기로 9단계 계산 (Vercel 타임아웃 위험)
await calculateCartTotal(webhookPayload)  // 최대 10초+
return new Response('OK')
// ✅ 웹훅은 즉시 저장 → 200 OK → pg_cron 백그라운드 처리
await supabase.from('raw_webhook_logs').insert({payload, processed: false})
return new Response('OK', { status: 200 })  // 1초 이내

// ❌ 만료 필터 없는 가용성 조회
.in('status', ['temp', 'confirmed'])
// ✅ .or(`status.eq.confirmed,and(status.eq.temp,expires_at.gt.${now})`)

// ❌ 서버 키 클라이언트 노출 — Husky 자동 차단
import { TOSS_SECRET_KEY } from '$env/static/public'
// ✅ import { TOSS_SECRET_KEY } from '$env/static/private'

// ❌ 기존 마이그레이션 파일 직접 수정 — Husky 자동 차단
// ✅ 새 파일로 ALTER 처리
```

---

## 에러 분류 체계 (Error Taxonomy — v3.2 신규)

```
Class A (Transient)    : API Rate Limit, 네트워크 → 5회 Backoff
Class B (Deterministic): 컴파일·린트·테스트 실패 → 3회 Self-Correction
Class C (Semantic)     : 요구사항 불명확, QA 3회 REJECT → Stephen 에스컬레이션
Class D (Critical)     : 서버 키 노출, 가드레일 수정 → 즉시 세션 종료

상세: .claude/harness/ERROR_TAXONOMY.md
```

---

## 도메인 규칙 파일 (✅ 생성 완료 — v3.2)

```
.claude/rules/
├── core-rules.md         ← 개발 실행 원칙 (스택, 파일 경로, 품질 기준)
├── rental.md             ← M2 렌탈·예약·가용성 (RPC, 상태머신, 할인)
├── payment.md            ← M3 결제·환불·PG (웹훅, 멱등성, 9단계)
├── ui-mobile.md          ← SvelteKit 5 UI + 모바일 UX (runes, CSS 변수, 터치 타겟)
├── uiux.md               ← 디자인 시스템 정본 (토큰·컴포넌트 패턴·Figma 기준)
└── security-auth.md      ← 인증·RLS·HMAC·환경변수 분리
```

→ harness-executor가 태스크 실행 전 관련 rules/*.md를 자동 로드
→ sp3-qa-agent가 GATE E 전 전 항목 grep 자동 검증

---

## 디렉토리 구조

```
crazyshot-svelte/
├── AGENTS.md                          ← 루트 헌장 (이 파일)
├── CLAUDE.md                          ← 세션 시작 가이드
├── scripts/
│   └── init-harness.sh                ← 다른 프로젝트 부트스트래핑용
├── .claude/
│   ├── agents/
│   │   ├── promptor.md                ← 대형 아젠다 분석 (선택)
│   │   ├── harness-executor.md        ← GSD+TDD 통합 실행 (핵심)
│   │   └── shared/
│   │       ├── sp2-tdd-agents.md
│   │       ├── sp3-qa-agent.md
│   │       └── sp4-deploy-agent.md
│   ├── harness/
│   │   ├── TASK.md                    ← NOW 태스크
│   │   ├── GSD_LOG.md                 ← 실행 이력
│   │   ├── ROLLBACK_LOG.md            ← 반려·롤백 이력
│   │   ├── ARCHITECTURE.md            ← 5계층 아키텍처 다이어그램
│   │   ├── ERROR_TAXONOMY.md          ← 에러 분류 + 에스컬레이션 (v3.2 신규)
│   │   ├── HANDOFF_TEMPLATE.md        ← 세션 핸드오프 프로토콜 (v3.2 신규)
│   │   ├── context-hook.md            ← 컨텍스트 롯 방지 (HOOK-1~6)
│   │   ├── middleware-guards.md       ← 보안·도구 제약
│   │   └── learnings/                 ← 자동 학습 기록
│   └── rules/
│       ├── core-rules.md
│       ├── rental.md
│       ├── payment.md
│       ├── ui-mobile.md
│       └── security-auth.md
└── src/ ...
```

---

## SvelteKit 5 추가 금지 패턴 (v3.1 신규)

```typescript
// ❌ Svelte 4 이벤트 문법 (Svelte 5에서 경고/에러)
<button on:click={handler}>   // → <button onclick={handler}>
<input on:input={handler}>    // → <input oninput={handler}>

// ❌ Svelte 4 상태 관리 (→ $state 사용)
import { writable } from 'svelte/store'
const count = writable(0)     // → let count = $state(0)

// ❌ Svelte 4 props (→ $props 사용)
export let productId: string  // → let { productId }: Props = $props()
```

---

*AGENTS.md | Harness Flow v3.2 | crazyshot 시범서비스 오픈 목표*
