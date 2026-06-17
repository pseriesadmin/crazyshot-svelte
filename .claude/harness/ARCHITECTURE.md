# ARCHITECTURE.md — Harness Flow v3.2: 5계층 + 3-Tier Orchestration
# 엔터프라이즈 하네스 엔지니어링 마스터 가이드 × Crazyshot 최적화

---

## 개요

Harness Flow v3.2는 2026 엔터프라이즈 마스터 가이드의 5계층 아키텍처를 Crazyshot에 적용.
**모델이 아니라 하네스가 성능을 결정한다** — 자동화된 무결성 검증 + 자율 학습 루프.

---

## LAYER 1: Environment (격리 공간)

```
현재: 로컬 머신 + GitHub Actions
향후: Docker Compose (staging) → Vercel Fluid Compute (prod)

원칙:
- 에이전트는 src/, .claude/ 읽기/쓰기 가능
- .husky/, .github/workflows/, migration/ 읽기 전용
- 시스템 명령 (npm/supabase/tsc) 격리된 PATH 내에서만
```

---

## LAYER 2: Sensors (실시간 피드백)

```
검사 항목 (자동 실행):
1. npm run check     → TypeScript 컴파일 결과
2. npm run test      → 테스트 코드 통과/실패
3. npm run lint      → 코드 스타일 + ESLint
4. grep 정적 분석    → console.log, any 타입, 금지 패턴

피드백 채널:
- 성공: GATE C 진행
- 실패: .harness/learnings/[domain]_error.md 자동 생성 → 에이전트 다음 턴에 로드
```

---

## LAYER 3: Context (점진적 노출)

```
구조:
.claude/
├── rules/
│   ├── core-rules.md         ← 모든 태스크 공통
│   ├── rental.md             ← M2 예약 태스크만
│   ├── payment.md            ← M3 결제 태스크만
│   ├── ui-mobile.md          ← UI 태스크만
│   └── security-auth.md      ← 인증/보안 태스크만
├── harness/
│   ├── ARCHITECTURE.md       ← 이 파일
│   ├── middleware-guards.md  ← 보안/도구 제약
│   ├── mcp-servers.json      ← MCP 선언
│   └── learnings/            ← 디버깅 교훈 저장소
└── agents/
    ├── harness-executor.md   ← Planner/Generator
    └── shared/
        ├── sp2-tdd-agents.md   ← Generator (TDD)
        ├── sp3-qa-agent.md     ← Evaluator
        └── sp4-deploy-agent.md ← Deployer
```

### 로드 규칙 (harness-executor 자동)

```javascript
const taskDomain = analyzeDomain(task)
const rulesToLoad = [
  'core-rules.md',  // 항상
  ...{
    'm2': ['rental.md'],
    'm3': ['payment.md'],
    'ui': ['ui-mobile.md'],
    'auth': ['security-auth.md']
  }[taskDomain]
]
```

---

## LAYER 4: Tools & Interfaces (MCP 준비)

```
현재 도구:
- Supabase RPC (파라미터화된 쿼리)
- Bash (npm/git/supabase CLI)
- Grep (정적 분석)

제약 사항 (middleware-guards.md):
✅ 모든 쿼리는 RPC 경유 (직접 SQL X)
✅ 서버 키 (TOSS_SECRET_KEY 등) → $env/static/private만
✅ 클라이언트 입력은 서버사이드 재검증
✅ 도구 호출 실패 시 자동 exponential backoff
```

---

## LAYER 5: Control Loop (자율 검증 루프)

### A. Self-Correction Runner (새로 추가)

**시점:** 각 태스크 후 (GSD/TDD 모두)

**동작:**
```bash
npm run check        # TypeScript 컴파일
  ├─ Success → GATE C 진행
  └─ Fail    → .harness/learnings/compile_error.md 저장
             → 에이전트에 피드백 주입
             → 에이전트 자동 재시도 (최대 3회)

npm run test:fast    # TDD 도메인만 (sp2-tdd-agents)
  ├─ Success → GREEN 단계 완료
  └─ Fail    → 테스트 로그 저장 → 피드백
```

### B. Middleware Guards (새로 추가)

**실시간 제약:**
```typescript
// 1. PII Shield
입력/출력 스트림에서 자동 마스킹:
- /sk-[a-zA-Z0-9]{32,48}/g  → [REDACTED_KEY]
- /postgres:\/\/[^@]+@/     → [REDACTED_DB_URI]

// 2. Tool Budget (컨텍스트 절약)
"git" 키워드 없는 아젠다 → git_* 도구 제거

// 3. Tool Resilience (네트워크 복원력)
API 실패 → 지수 백오프 (1s, 2s, 4s) 자동 재시도
```

---

## 3-Tier Orchestration

```
        Planner                Generator               Evaluator
    (Planning Phase)        (Execution Phase)      (Verification Phase)
          │                      │                        │
    @harness-executor     @harness-executor        @sp3-qa-agent
    또는 @promptor        또는 @sp2-tdd-agents
          │                      │                        │
    역할:                 역할:                    역할:
    ✓ 아젠다 분석        ✓ 코드 작성              ✓ 결과물 평가
    ✓ TASK.md 생성       ✓ 테스트 작성            ✓ 규칙 검증
    ✓ 완료 기준 정의      ✓ 자가 검증 (npm check)  ✓ 통과/반려 판정
    ✓ 범위 확정          ✓ git 제외               ✓ GATE E 최종 결정
    
    출력:                 출력:                    출력:
    - TASK.md            - 구현 코드              - QA 리포트 (md)
    - 완료 기준           - 테스트 코드            - GATE E 판정
    - 실패 롤백점         - 컴파일 통과           - 이슈 목록 (있으면)
    
특징:
→ 각 에이전트가 '자신의 업무'만 수행
→ 자가 평가 금지 (편향성 방지)
→ 마지막 Evaluator만 최종 판정
```

---

## 자동화 흐름도

```
[B-START] ─→ @harness-executor (Planner)
             ├─ AGENTS.md + rules/* 로드
             ├─ TASK.md 생성 (완료 기준 포함)
             └─ GATE B 출력
             
[GATE B 승인] ─→ 도메인 판별
                ├─ GSD      → @harness-executor (Generator)
                │            └─ 파일 변경 → npm run check
                │                          ├─ 통과 → GATE C
                │                          └─ 실패 → 피드백 저장 → 자동 재시도
                │
                └─ TDD      → @sp2-tdd-agents (Generator)
                             ├─ RED (테스트 작성)
                             │   └─ GATE C [RED] 대기
                             ├─ GREEN (구현)
                             │   └─ npm run test → 실패 시 피드백
                             │   └─ GATE C [GREEN] 대기
                             └─ REFACTOR (최적화)
                                 └─ npm run check
                                 └─ GATE C [REFACTOR] 대기

[모든 GATE C 통과] ─→ @sp3-qa-agent (Evaluator)
                    ├─ 규칙 검증 (grep)
                    ├─ 기술 부채 확인
                    ├─ S2 시범서비스 기준 체크
                    └─ QA 리포트 출력
                    
[문제 없음] ─→ GATE E (최종 결정)
           ├─ 통과 → 커밋 허가 안내
           └─ 반려 → 이슈 목록 + 수정 요청

[커밋 완료] ─→ @sp4-deploy-agent
            └─ 배포 체크리스트
```

---

## Learning Directory (.harness/learnings/)

에이전트가 만드는 자동 학습 기록:

```
.harness/learnings/
├── compile_error.md            ← npm run check 실패 시 자동 생성
├── test_error.md               ← npm run test 실패 시 자동 생성
├── rental_patterns.md          ← M2 테스트 패턴 학습
├── payment_edge_cases.md       ← M3 결제 엣지 케이스 모음
└── svelte5_gotchas.md          ← SvelteKit 5 흔한 실수
```

각 파일은 에이전트가 다음 턴에 자동 로드 → 같은 실수 반복 방지.

---

## 실제 동작 예시

### GSD 태스크: UI 컴포넌트 추가

```
[B-START] UI: ProductCard 컴포넌트 작성
          
@harness-executor (Planner)
├─ ui-mobile.md 로드
├─ TASK.md 생성
│  ├─ 완료 기준: "ProductCard 렌더링 + 48×48px 버튼 확인"
│  └─ 예상 시간: 20분
└─ GATE B

[GATE B 승인]

@harness-executor (Generator)
├─ ProductCard.svelte 생성
├─ CSS 변수 사용 (하드코딩 색상 X)
├─ alt 속성 추가 (a11y)
├─ git 제외
└─ npm run check
   ├─ tsc: 성공
   ├─ lint: 성공
   └─ GATE C
   
[GATE C 승인]

@sp3-qa-agent (Evaluator)
├─ grep: on:click 검색 (0건 ✓)
├─ grep: Svelte 4 문법 (0건 ✓)
├─ grep: var(--) 사용 확인 (✓)
├─ QA 리포트: "PASS"
└─ GATE E

[GATE E 승인]

Stephen → git commit
```

### TDD 태스크: 결제 금액 계산 (M3)

```
[B-START] TDD: calculate_cart_total RPC 호출 테스트

@harness-executor (Planner)
├─ payment.md 로드 (9단계 계산 규칙)
├─ TASK.md 생성
│  ├─ 정상: "total 금액 정확히 계산"
│  ├─ 막기: "calc_at 30초 초과 값 통과 금지"
│  └─ 실패: "PRICE_EXPIRED 에러 반환"
└─ GATE B

[GATE B 승인]

@sp2-tdd-agents (Generator)
├─ RED: 테스트 작성 (Happy/Edge/Error)
│  └─ npm run test → 10개 실패 확인
│  └─ GATE C [RED]
├─ GREEN: 구현 (calculate_cart_total.sql)
│  └─ npm run test → 10개 통과
│  └─ GATE C [GREEN]
├─ REFACTOR: 쿼리 최적화
│  └─ npm run check
│  └─ GATE C [REFACTOR]

[모든 GATE C 승인]

@sp3-qa-agent (Evaluator)
├─ 테스트 커버율: 90% ✓ (결제 도메인 기준)
├─ calc_at 유효성: 검증됨 ✓
├─ 멱등성 (idempotency_key): 검증됨 ✓
├─ QA 리포트: "PASS"
└─ GATE E

[GATE E 승인]

Stephen → git commit
```

---

## Error Taxonomy (에러 분류 체계)

엔터프라이즈 마스터 가이드 ch.13 구현. 상세: `ERROR_TAXONOMY.md`

```
Class A (Transient)    → 5회 Backoff 자동 재시도
Class B (Deterministic)→ 3회 Self-Correction → .harness/learnings/ 저장
Class C (Semantic)     → 즉시 Stephen 에스컬레이션
Class D (Critical)     → 세션 즉시 종료 + 감사 로그
```

각 에이전트의 Self-Correction Runner는 이 분류에 따라 자동 대응한다.

---

## Observability (관측성)

```
.harness/learnings/
├── compile_error.md         ← Class B 컴파일 실패 자동 기록
├── test_error.md            ← Class B 테스트 실패 자동 기록
├── misidentifications.md    ← 도메인 오인 카탈로그 (HOOK-7)
│                               | 날짜 | 도메인 | 오인 | 올바른해석 | 원인 | 횟수 |
└── [domain]_patterns.md     ← 도메인별 학습 기록

.harness/telemetry/
├── critical_audit.jsonl     ← Class D 위반 감사 로그
└── budget_alerts.jsonl      ← Guard 8 토큰 예산 경보 로그
```

**에러 → 학습 루프:**
```
Class B 에러 발생
    ↓
.harness/learnings/[domain]_error.md 자동 저장
    ↓
같은 세션 다음 턴에 자동 참조
    ↓
다음 세션 HOOK-4 재시작 시 로드 → 반복 실수 방지
```

---

## 세션 생명주기 (Session Lifecycle)

```
새 세션 시작 → HOOK-4 (재시작 브리핑)
     ↓
B-START → GATE B → 태스크 실행
     ↓
HOOK 감지 (HOOK-1~5) → 자동 개입
     ↓
Self-Correction (Class B) → 최대 3회
     ↓
Class C/D 에러 → Stephen 에스컬레이션
     ↓
모든 NOW 완료 → GATE E → 커밋
     ↓
세션 과부하 신호 → HOOK-6 (핸드오프)
→ HANDOFF.md 생성 → 새 세션으로 이관
```

---

## Checkpoint: v3.1 vs v3.2

| 항목 | v3.1 | v3.2 |
|------|------|------|
| GATE 구조 | B→C→E | B→C(반복)→E |
| 자동 검증 | 수동 | npm check/test 자동 |
| 피드백 루프 | 없음 | .harness/learnings/ 자동 저장 |
| 도메인 규칙 | 수동 로드 | Planner 자동 로드 |
| 3-Tier | 개념만 | 명시적 역할 분리 |
| 미들웨어 | 없음 | PII Shield + Tool Budget |
| **Error Taxonomy** | **없음** | **Class A/B/C/D 분류 + 자동 대응** |
| **세션 핸드오프** | **없음** | **HOOK-6 + HANDOFF_TEMPLATE.md** |
| **Bootstrap** | **없음** | **scripts/init-harness.sh** |
| Learning | 없음 | 디버깅 교훈 자동 축적 |
| **설계-구현 대조** | **없음** | **G-0.5 사전 대조 + plan_source 필드** |
| **Default-Exclude** | **없음** | **P5 명시 승인 항목만 NOW 진입** |
| **토큰 예산 인식** | **선언적** | **Guard 8 경보 기준 + telemetry 로그** |
| **비전문가 GATE** | **기술자 기준** | **서비스 의도 언어 + CRITICAL/BOUNDARY/ROUTINE 분류** |
| **오인 카탈로그** | **없음** | **HOOK-7 캡처 + misidentifications.md 누적** |
| **회귀 커버리지** | **변경파일만** | **Guard 9 모듈 의존성 맵 + 도메인 최소 기준** |
| **BLOCKED Skip** | **수동** | **HOOK-8 자동 감지 + 스킵/대기/대안 3선택** |

---

*ARCHITECTURE.md v3.2 | Harness Flow | Crazyshot 시범서비스 오픈*
