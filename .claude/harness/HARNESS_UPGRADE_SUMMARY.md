# HARNESS_UPGRADE_SUMMARY.md
# Crazyshot Harness Flow: v3.1 → v3.2 업그레이드 완료 리포트
# 2026-06-09 | Harness Flow v3.2 × 엔터프라이즈 마스터 가이드 통합

---

## Executive Summary

Crazyshot의 Harness Flow를 엔터프라이즈 2026 마스터 가이드의 **5계층 아키텍처 + 3-Tier Orchestration + 자율 검증 루프**로 업그레이드 완료.

**효과:**
- 🔄 **자동 무결성 검증** — 컴파일/테스트 실패 시 자동 피드백 + 에이전트 자동 재시도
- 📚 **Learning Directory** — 디버깅 교훈 누적 → 같은 오류 반복 방지
- 🛡️ **미들웨어 가드레일** — PII 자동 마스킹, 도구 절감, 지수 백오프
- 🎯 **명확한 역할 분리** — Planner/Generator/Evaluator 3-Tier 명시
- 📊 **컨텍스트 관리** — 대용량 로그 오프로딩, MCP 준비

---

## 업그레이드 내용

### 1. 새로운 파일 추가

| 파일 | 용도 | 상태 |
|-----|------|------|
| `.claude/harness/ARCHITECTURE.md` | 5계층 + 3-Tier 아키텍처 명시 | ✅ 완성 |
| `.claude/harness/middleware-guards.md` | 7가지 보안 가드레일 + 규칙 | ✅ 완성 |
| `.claude/harness/mcp-servers.json` | MCP 서버 공식 선언 | ✅ 완성 |
| `.claude/harness/learning-patterns.md` | 디버깅 패턴 템플릿 | ⏳ 다음 |

### 2. 기존 파일 업그레이드

| 파일 | 변경 사항 | 상태 |
|-----|---------|------|
| `AGENTS.md` | 5계층 + 3-Tier Orchestration 추가 | ✅ 업데이트 |
| `harness-executor.md` | v3.1 → v3.2, Self-Correction Runner 명시 | ✅ 업데이트 |
| `sp2-tdd-agents.md` | GREEN 단계 자동 검증 추가 | ✅ 업데이트 |
| `sp3-qa-agent.md` | Evaluator 역할 강화 | ⏳ 권장 |
| `sp4-deploy-agent.md` | 배포 체크리스트 유지 | ✅ 유지 |

---

## 3계층 Orchestration 명확화

### Before (v3.1)
```
harness-executor → 계획 + 생성 (동시)
↓
sp3-qa-agent → 평가
```

### After (v3.2)
```
🟢 Planner (@harness-executor)
   └─ TASK.md 생성 + 완료 기준 정의
   
🟠 Generator (@harness-executor / @sp2-tdd-agents)
   └─ 코드 작성 + 자동 검증 (Self-Correction)
   
🔵 Evaluator (@sp3-qa-agent)
   └─ 3단계 검수 + GATE E 판정
```

**특징:**
- 각 층이 **자기 업무만** 수행
- 자가 평가 금지 (편향성 방지)
- 마지막 Evaluator만 최종 판정

---

## 5계층 Harness Architecture (새로 명시)

| 계층 | 담당 | 도구 | 상태 |
|------|------|------|------|
| **L1: Environment** | 작업 공간 격리 | 로컬 + GitHub Actions | 현재 유지 |
| **L2: Sensors** | 실시간 피드백 | npm check/test/lint | 기존 강화 |
| **L3: Context** | 도메인 규칙 | .claude/rules/*.md | 기존 유지 |
| **L4: Tools** | 인터페이스 표준화 | MCP (선언) | 새로 추가 |
| **L5: Control Loop** | 자동 검증 루프 | Self-Correction Runner | 새로 추가 ⭐ |

### L5: Control Loop (핵심 신규)

```javascript
// GSD 태스크 후
npm run check
  ├─ Success → GATE C
  └─ Fail    → .harness/learnings/compile_error.md
             → 에이전트 다음 턴에 자동 로드
             → 에이전트 자동 수정 시도 (3회 반복)

// TDD 태스크 GREEN 후
npm run test + npm run check
  └─ Fail → .harness/learnings/green_compile_error.md
           → 피드백 반복
```

---

## 7가지 Middleware Gua rdRails

| Guard | 목적 | 구현 상태 |
|-------|------|---------|
| 1️⃣ **PII Shield** | API 키/DB URI 자동 마스킹 | 명시 ✅ |
| 2️⃣ **Tool Budget** | 필요한 도구만 선택 (토큰 절약) | 명시 ✅ |
| 3️⃣ **Resilience** | 지수 백오프 자동 재시도 | 명시 ✅ |
| 4️⃣ **Input Validation** | 서버사이드 재검증 | 규칙 ✅ |
| 5️⃣ **Compile Gate** | pre-commit 훅 강제 | 유지 ✅ |
| 6️⃣ **Webhook Signature** | HMAC-SHA256 검증 | 규칙 ✅ |
| 7️⃣ **RLS 정책** | Row-Level Security | 규칙 ✅ |

---

## Learning Directory 구조

자동 학습 기록 → 에이전트가 다음 턴에 자동 로드:

```
.harness/learnings/
├── compile_error.md           ← npm run check 실패
├── test_error.md              ← npm run test 실패
├── green_compile_error.md     ← TDD GREEN 후 컴파일 실패
├── rental_patterns.md         ← M2 (예약) 패턴 모음
├── payment_edge_cases.md      ← M3 (결제) 엣지 케이스
└── svelte5_gotchas.md         ← SvelteKit 5 흔한 실수
```

**동작:**
```
컴파일 실패
  ↓
에러 메시지 캡처
  ↓
.harness/learnings/compile_error.md 생성
  ↓
에이전트 다음 턴: 자동 로드
  "최근 컴파일 에러: [내용]\n수정해야 할 파일: [경로]"
  ↓
에이전트 자동 수정
  ↓
3회까지 반복 → 여전히 실패 → GATE C 호출
```

---

## MCP (Model Context Protocol) 선언

공식 MCP 서버 정의 (현재는 선언, 향후 단계적 구현):

```json
// .claude/harness/mcp-servers.json

mcpServers: {
  "supabase_mcp": {           // v3.2 ~
    RPC 호출 + 안전한 쿼리
  },
  "postgres_mcp": {            // v3.2 ~
    스키마 탐색 + EXPLAIN
  },
  "playwright_mcp": {          // v3.4
    UI 스크린샷 + 반응형 테스트
  },
  "github_mcp": {              // v3.5
    PR 생성 + 이슈 관리
  }
}
```

---

## 실제 동작 예시

### GSD 태스크: UI 컴포넌트

```
[B-START] "ProductCard 컴포넌트 추가"
          ↓
@harness-executor (Planner)
├─ ui-mobile.md 로드
├─ TASK.md 생성 (완료 기준: "44×48px 버튼 확인")
└─ GATE B

[GATE B 승인]

@harness-executor (Generator)
├─ ProductCard.svelte 작성
├─ npm run check → 성공 ✓
├─ npm run lint → 성공 ✓
└─ GATE C

[GATE C 승인]

@sp3-qa-agent (Evaluator)
├─ on:click 검색 (Svelte 5) → 0건 ✓
├─ var(--) CSS 변수 → ✓
└─ GATE E
```

### TDD 태스크: 결제 금액 계산

```
[B-START] TDD: "calculate_cart_total 함수 테스트"
          
@harness-executor (Planner) → payment.md 로드, TASK.md 생성

[GATE B 승인]

@sp2-tdd-agents (Generator)
├─ RED: 테스트 작성 (Happy/Edge/Error) → 10개 실패 확인
├─ GATE C [RED]
├─ GREEN: 구현 → 10개 통과
│         npm run check → 성공 ✓
├─ GATE C [GREEN]
├─ REFACTOR: 쿼리 최적화
│           npm run check → 성공 ✓
└─ GATE C [REFACTOR]

[모든 GATE C 통과]

@sp3-qa-agent (Evaluator)
├─ 테스트 커버율 90% ✓
├─ calc_at 유효성 검증 ✓
├─ 멱등성 (idempotency_key) ✓
└─ GATE E → PASS
```

---

## 마이그레이션 가이드 (기존 태스크)

기존 harness-executor를 사용하던 태스크는 **자동으로** 업그레이드됨:

```
1. 기존 GATE 흐름 유지 (B → C → E)
2. 새로운 자동 검증은 투명하게 추가
   → npm run check 자동 실행 (GATE C 진행 전)
   → 실패 시 .harness/learnings/에 자동 저장
   → 에이전트가 자동 로드 + 수정

3. 기존 작업 중단 없음
   → 현재 진행 중인 M2/M3 태스크는 그대로 진행
```

---

## 체크리스트: v3.2 적용 확인

```
[ ] ARCHITECTURE.md 읽음
[ ] middleware-guards.md 7가지 Guard 이해
[ ] mcp-servers.json 구조 확인
[ ] Learning Directory 역할 이해
[ ] 3-Tier Orchestration (Planner/Generator/Evaluator) 이해
[ ] Self-Correction Runner 동작 원리 이해
[ ] 기존 GATE 흐름과의 호환성 확인

[ ] harness-executor.md v3.2 업데이트 확인
[ ] sp2-tdd-agents.md GREEN 자동 검증 확인
[ ] AGENTS.md 5계층 추가 확인

추천:
[ ] 다음 새 태스크에서 v3.2 신기능 실제 체험
    → Learning Directory 확인
    → 자동 검증 피드백 확인
```

---

## FAQ

### Q1. 기존 태스크 진행 중인데, 지금 v3.2 적용해야 함?
**A.** 아니오. 투명하게 적용됨. 새 태스크부터 신기능 체험 권장.

### Q2. Learning Directory에 저장된 파일은 누가 관리?
**A.** 에이전트가 자동 생성 → 에이전트가 자동 로드. 인간은 필요시 검토만.

### Q3. Self-Correction Runner가 3회 재시도 후에도 실패하면?
**A.** GATE C 호출. Stephen의 개입 필요.

### Q4. MCP 구현은 언제?
**A.** Roadmap:
- v3.2: 선언 (완료)
- v3.3: Supabase MCP 구현
- v3.4: Playwright MCP (UI 테스트)
- v3.5: GitHub MCP (자동 PR)

### Q5. .harness/learnings/ 디렉터리는 git에 커밋?
**A.** **권장 사항:**
```
.gitignore에 추가:
.claude/harness/learnings/compile_error.md
.claude/harness/learnings/test_error.md
.claude/harness/learnings/green_compile_error.md
```
(패턴 파일은 커밋, 에러 로그는 git 제외)

---

## 다음 단계

### 즉시 (v3.2 완료)
✅ ARCHITECTURE.md 읽기
✅ middleware-guards.md 검토
✅ mcp-servers.json 구조 이해

### 단기 (2-3 주)
⏳ M3 (Payment) TDD 태스크에서 Learning Directory 활용 확인
⏳ Self-Correction Runner 동작 검증

### 중기 (1-2 개월)
⏳ Supabase MCP 구현 (v3.3)
⏳ Playwright MCP (v3.4)

### 장기 (시범서비스 안정화)
⏳ GitHub MCP (v3.5)
⏳ Docker Compose 격리 환경 (Staging/Prod)

---

## 참조

```
📄 ARCHITECTURE.md         → 5계층 + 3-Tier 아키텍처
📄 middleware-guards.md    → 7가지 보안/최적화 가드레일
📄 mcp-servers.json        → MCP 서버 정의
📄 AGENTS.md               → 황금 원칙 + TDD 도메인
📄 harness-executor.md     → Planner/Generator 역할
📄 sp2-tdd-agents.md       → Generator (TDD) 역할
📄 sp3-qa-agent.md         → Evaluator 역할

기존 규칙:
📄 .claude/rules/core-rules.md
📄 .claude/rules/rental.md
📄 .claude/rules/payment.md
📄 .claude/rules/ui-mobile.md
📄 .claude/rules/security-auth.md
```

---

*HARNESS_UPGRADE_SUMMARY.md*
*Harness Flow v3.2 | Crazyshot | 2026-06-09*
