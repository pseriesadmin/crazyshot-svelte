# PORTABILITY.md — 하네스 플로 이식성 구조
# Harness Flow v3.2 | 타 프로젝트 적용 가이드

---

## 개요

Harness Flow v3.2는 **범용 계층(Universal Layer)**과 **프로젝트 계층(Project Layer)**으로
명확히 분리된다. 범용 계층만 가져가면 어떤 웹 서비스 프로젝트에도 바로 적용 가능하다.

---

## 계층 구조

```
Harness Flow v3.2
├── Universal Layer (프로젝트 무관 — 그대로 복사)
│   ├── GATE 시스템
│   │   ├── GATE 중요도 분류 (CRITICAL/BOUNDARY/ROUTINE) — harness-executor 1b
│   │   ├── 비전문가 서비스 의도 확인 포맷 — harness-executor GATE B/C/E
│   │   └── 기획 의도 질문 작성 원칙
│   ├── HOOK 시스템
│   │   ├── HOOK-1~5: 컨텍스트 롯 방지
│   │   ├── HOOK-6: 세션 핸드오프
│   │   ├── HOOK-7: 오인 카탈로그 캡처 (신규)
│   │   └── HOOK-8: BLOCKED 자동 감지 + Skip 제안 (신규)
│   ├── Guard 시스템
│   │   ├── Guard 1: PII Shield
│   │   ├── Guard 2: Tool Budget
│   │   ├── Guard 3: Resilience (Backoff)
│   │   ├── Guard 4: Input Validation
│   │   ├── Guard 5: Compile Gate
│   │   └── Guard 8: Token Budget Awareness (신규)
│   ├── Error Taxonomy
│   │   ├── Class A/B/C/D 분류 및 에스컬레이션
│   │   └── 오인 카탈로그 (misidentifications.md) 구조
│   ├── 3-Tier Orchestration (Planner/Generator/Evaluator)
│   ├── HANDOFF 프로토콜 (HANDOFF_TEMPLATE.md)
│   └── Self-Correction Runner
│
└── Project Layer (프로젝트별 커스터마이즈 필요)
    ├── TDD 강제 도메인 키워드 목록 (AGENTS.md)
    ├── 도메인 규칙 파일 (.claude/rules/)
    │   예: rental.md / payment.md → 새 프로젝트는 자체 도메인 규칙 작성
    ├── Guard 6: 웹훅 서명 검증 (PG사별 다름)
    ├── Guard 7: RLS 정책 (DB 설계별 다름)
    ├── Guard 9: 회귀 커버리지 모듈 의존성 맵 (아키텍처별 다름)
    ├── GATE C [GREEN] 도메인 정책 목록 (서비스별 다름)
    └── plan_source 형식 (plannode-tree / PRD / 기타)
```

---

## 타 프로젝트 적용 절차

### Step 1: Universal Layer 복사

```bash
bash scripts/init-harness.sh --project {프로젝트명} --stack {nextjs|sveltekit|nuxt|generic}
```

생성 항목 (v3.2 기준):
```
.claude/
├── harness/
│   ├── TASK.md, GSD_LOG.md, ROLLBACK_LOG.md
│   ├── ARCHITECTURE.md, ERROR_TAXONOMY.md
│   ├── HANDOFF_TEMPLATE.md, PORTABILITY.md
│   ├── context-hook.md (HOOK-1~8)
│   ├── middleware-guards.md (Guard 1~5, 8)
│   └── learnings/misidentifications.md (빈 템플릿)
├── agents/
│   ├── harness-executor.md (GATE 시스템 포함)
│   ├── promptor.md (Default-Exclude 포함)
│   └── shared/sp2,sp3,sp4-*.md
└── rules/
    └── core-rules.md (기본 코드 품질만)
```

### Step 2: Project Layer 커스터마이즈

다음 항목을 새 프로젝트 도메인에 맞게 작성:

```
AGENTS.md:
  TDD 강제 도메인 → 새 프로젝트의 핵심 비즈니스 로직 키워드로 교체

.claude/rules/ 추가:
  {domain1}.md — 핵심 도메인 규칙
  {domain2}.md — 결제/인증 등 추가 도메인

harness-executor.md 1b 수정:
  CRITICAL 조건의 TDD 도메인 키워드를 새 프로젝트 키워드로 교체

middleware-guards.md Guard 9 수정:
  모듈 의존성 맵을 새 프로젝트 모듈 구조로 교체

harness-executor.md GATE C [GREEN] 수정:
  M2/M3/M4/M5 도메인 항목을 새 프로젝트 도메인으로 교체
```

### Step 3: 비전문가 GATE 원칙은 그대로 유지

비전문가 GATE 포맷 (기획 의도 질문 원칙)은 **수정하지 않는다**.
어떤 프로젝트든 인간 승인자가 기술자가 아닐 경우 동일하게 적용된다.

---

## Universal Layer의 핵심 불변 원칙

어떤 프로젝트에 적용해도 절대 변경하면 안 되는 원칙:

```
1. GATE는 서비스 의도가 흔들릴 수 있는 지점에만 발동
2. Stephen(인간 승인자)에게는 기술 용어 노출 금지
3. 기획 의도 질문은 고객/사용자 행동 + 비즈니스 정책 형식
4. ROUTINE 등급은 자율 진행 (인간 개입 불필요)
5. 오인 발생 시 반드시 misidentifications.md 기록
6. git 자율 실행 절대 금지 (어떤 프로젝트든)
```

---

## init-harness.sh 업데이트 필요 항목 (v3.2 이후)

현재 스크립트(v3.1 기준)에서 누락된 v3.2 신규 항목:

```
[ ] GATE 중요도 분류 (1b 섹션) harness-executor 템플릿에 추가
[ ] 비전문가 GATE B/C/E 포맷 반영
[ ] HOOK-7 (오인 캡처), HOOK-8 (BLOCKED Skip) 추가
[ ] Guard 8 (Token Budget), Guard 9 템플릿 추가
[ ] misidentifications.md 빈 템플릿 생성
[ ] PORTABILITY.md 생성
[ ] Default-Exclude 원칙 promptor 템플릿 반영
[ ] plan_source 필드 TASK.md 템플릿 추가
```

---

## Cursor AI 이식 가이드

### Cursor AI와 Claude Code의 구조 차이

```
구분              Claude Code                    Cursor AI
──────────────────────────────────────────────────────────────
규칙 파일 위치   .claude/agents/*.md            .cursor/rules/*.mdc
파일 포맷        Markdown + YAML frontmatter    Markdown + YAML frontmatter (유사)
에이전트 호출    @harness-executor              규칙이 자동 적용 (호출 없음)
Tool 선언        tools: Read, Grep, Bash...     없음 (Cursor가 자동 판단)
컨텍스트 로드    Progressive (HOOK-4 등)        @Codebase, @Docs, @Files 수동
GATE 포맷        텍스트 출력 (채팅)             텍스트 출력 (채팅) — 동일
TASK.md          .claude/harness/TASK.md        어디든 가능 — 그대로 사용
오인 카탈로그    .harness/learnings/*.md        어디든 가능 — 그대로 사용
```

### 이식 가능 항목 (변환 없이 그대로)

```
✅ 직접 복사 사용 가능:
   - TASK.md, GSD_LOG.md, ROLLBACK_LOG.md, HANDOFF.md — 순수 마크다운
   - .harness/learnings/misidentifications.md — 순수 마크다운
   - GATE 포맷 (B/C/E 텍스트 포맷) — 채팅 텍스트, AI 종류 무관
   - 오인 카탈로그 구조 — 마크다운 테이블
   - Error Taxonomy 개념 (Class A/B/C/D) — 지침이므로 그대로 적용
   - Default-Exclude 원칙 — 규칙이므로 그대로 적용
   - BLOCKED Skip 프로토콜 — 워크플로우이므로 그대로 적용
```

### 변환 필요 항목 (형식 전환)

```
Claude Code → Cursor AI 변환 맵:
──────────────────────────────────────────────────────────────
.claude/agents/harness-executor.md
  → .cursor/rules/harness-executor.mdc
  frontmatter 변환:
    name: harness-executor
    tools: Read, Grep, Glob, Bash, Edit
    ↓
    description: "Harness Flow 핵심 실행 에이전트"
    alwaysApply: false
    globs: ["**/*"]   ← B-START 입력 시 적용

.claude/agents/promptor.md
  → .cursor/rules/promptor.mdc (동일 방식)

.claude/harness/context-hook.md
  → .cursor/rules/context-hooks.mdc
  HOOK 트리거 조건을 Cursor rule 형식으로 표현:
    alwaysApply: true   ← 항상 적용

.claude/rules/core-rules.md
  → .cursor/rules/core-rules.mdc
  alwaysApply: true

.claude/rules/payment.md 등 도메인 규칙
  → .cursor/rules/domain-payment.mdc
  globs: ["src/routes/api/payment/**", "src/lib/services/payment*"]
  ← 결제 관련 파일 열 때 자동 적용
```

### Cursor .mdc 파일 예시 (harness-executor 변환)

```markdown
---
description: Harness Flow 핵심 실행 에이전트 — B-START 처리 및 GATE 관리
alwaysApply: false
---

# harness-executor

## 역할
B-START 아젠다를 받으면 TASK.md를 만들고 GATE B를 기다린다.
GATE B 승인이 오면 NOW 태스크를 하나씩 실행하고 GATE C에서 멈춘다.
git은 절대 혼자 실행하지 않는다.

[이하 내용은 Claude Code 버전과 동일]
```

### Cursor에서 작동 안 되는 항목 (대체 방법)

```
Claude Code 전용 기능          Cursor 대체 방법
──────────────────────────────────────────────────────────────
@agent-name 명시 호출         규칙 파일이 자동 적용됨
                               필요 시 "harness-executor 규칙 따라서..." 프롬프트
tools: 선언으로 도구 제한      Cursor는 자동 도구 선택 (제한 없음)
HOOK 자동 감지·실행            규칙 파일 내 조건 기술로 동일 효과
                               단, 트리거 자동화 강도는 낮아짐
Progressive Context Loading   @Files로 수동 로드 또는 alwaysApply 활용
```

### Cursor 이식 시 init 방법

현재 init-harness.sh는 Claude Code 기준.
Cursor 프로젝트에는 다음 수동 절차:

```bash
# 1. 기본 파일 구조 생성
mkdir -p .cursor/rules .harness/learnings

# 2. Universal 계층 마크다운 파일 복사 (수정 불필요)
cp .claude/harness/TASK.md .harness/TASK.md
cp .claude/harness/HANDOFF_TEMPLATE.md .harness/HANDOFF_TEMPLATE.md
cp .claude/harness/ERROR_TAXONOMY.md .harness/ERROR_TAXONOMY.md
cp .claude/harness/learnings/misidentifications.md .harness/learnings/

# 3. 에이전트 파일을 .mdc로 변환 (frontmatter만 교체)
# harness-executor.md → .cursor/rules/harness-executor.mdc
# context-hook.md    → .cursor/rules/context-hooks.mdc
# 도메인 rules/*.md  → .cursor/rules/domain-*.mdc

# 4. GATE 포맷, 오인 카탈로그, Error Taxonomy는 그대로 참조
```

### 결론: Cursor AI 이식성 평가

```
✅ 완전 이식 가능 (90% 이상 동일 동작):
   - GATE 시스템 (B/C/E 포맷) — 채팅 텍스트라 동일
   - 오인 카탈로그 — 마크다운이라 동일
   - Default-Exclude 원칙 — 지침이라 동일
   - BLOCKED Skip 프로토콜 — 워크플로우라 동일
   - Error Taxonomy 개념 — 지침이라 동일
   - 비전문가 GATE 원칙 — 질문 형식이라 동일

⚠️ 부분 적용 (형식 변환 필요):
   - 에이전트 파일 → .mdc 형식으로 frontmatter 교체
   - 도메인 규칙 → globs 기반 자동 적용으로 전환

❌ Cursor에서 완전 재현 불가:
   - @agent-name 명시 호출 (Cursor에 없는 기능)
   - Tool 사용 제한 선언 (Cursor는 자동)
   - HOOK 자동 트리거 (수동으로 언급 필요)
```

---

*PORTABILITY.md v3.2 | Harness Flow | 범용-프로젝트·Claude Code·Cursor AI 이식성 가이드*
