# ENTERPRISE_INTEGRATION_v3.2.md
# 엔터프라이즈 하네스 엔지니어링 마스터 가이드 2026 × Crazyshot 최적화
# 8대 항목별 보완 + 현황 평가

---

## 개요

마스터 가이드의 엔터프라이즈 아키텍처 (5계층 + Middleware + Self-Healing) 를 Crazyshot v3.2에 통합하는 과정에서 현실적 제약과 단계적 구현을 고려한 **8대 항목별 보완 전략**. 

현재 v3.2는 **기초 구조 완성 (Layer 1-5 선언) → 향후 단계별 고도화**.

---

## 📋 8대 항목 종합 평가

| # | 항목 | 현황 | 우선도 | 예상 비용 |
|----|------|------|-------|---------|
| 1 | **프로젝트 구조설계** | ⚠️ 부분 완성 | P1 | 중 |
| 2 | **도구 배치** | ✅ 완성 70% | P1 | 중 |
| 3 | **경계 설정** | ✅ 완성 80% | P0 | 저 |
| 4 | **세션별 맥락 관리** | ⚠️ 부분 | P1 | 중 |
| 5 | **실행 계획 관리** | ✅ 완성 | P0 | 완료 |
| 6 | **오케스트레이션 패턴** | ⚠️ 선언만 | P1 | 고 |
| 7 | **검증 규칙 설계** | ✅ 완성 80% | P0 | 저 |
| 8 | **자가 개선 루프** | ✅ 신규 80% | P0 | 저 |

---

## 1️⃣ 프로젝트 구조설계

### 현황 평가

**완성도:** 60% ⚠️

```
✅ 기존:
crazyshot-svelte/
├── .claude/
│   ├── agents/          (4개 에이전트)
│   ├── harness/         (태스크 + 학습)
│   └── rules/           (5개 도메인)
├── src/
│   ├── lib/
│   ├── routes/
│   └── __tests__/
└── migrations/

❌ 부족:
- Monorepo 구조 (현재: 단일 SvelteKit 프로젝트)
- 역할별 폴더 명확화 (Agent/Harness/Rules 구분은 있으나, 아키텍처 레벨은 부족)
- 아키텍처 품질 지표 (린트/타입/테스트 자동 검증 규칙)
```

### 추가 보완

#### 1.1 폴더 구조 현대화

```
crazyshot-svelte/           ← SvelteKit 프로젝트 (현재 유지)
├── .claude/                 ← Harness 레이어 (현재 유지)
│   ├── agents/
│   ├── harness/
│   ├── rules/
│   └── memory/              ← NEW: 세션별 메모리
│
├── .github/                 ← CI/CD (현재 부분)
│   └── workflows/
│       ├── typecheck.yml    ← NEW: 자동 타입 검사
│       ├── test-coverage.yml ← NEW: 커버리지 게이트
│       └── lint-gates.yml   ← NEW: ESLint 자동화
│
├── architecture/            ← NEW: 아키텍처 문서 (선택)
│   ├── ARCHITECTURE.md      (이미 .claude/harness에 있음)
│   └── C4_DIAGRAMS.md       ← NEW: C4 아키텍처 다이어그램
│
├── src/
│   ├── lib/
│   │   ├── services/        ← 도메인 로직 (현재)
│   │   ├── components/      ← UI 컴포넌트 (현재)
│   │   ├── stores/          ← 상태 관리 (현재)
│   │   └── utils/           ← 유틸 함수 (현재)
│   │
│   ├── routes/
│   │   ├── api/             ← REST 엔드포인트 (현재)
│   │   └── +*.svelte        ← 페이지 (현재)
│   │
│   └── __tests__/           ← 테스트 (현재)
│       ├── unit/
│       ├── integration/
│       └── e2e/
│
└── scripts/                 ← NEW: 자동화 스크립트
    ├── validate-architecture.sh
    ├── generate-types.sh
    └── health-check.sh
```

#### 1.2 아키텍처 품질 자동 검증

```bash
# scripts/validate-architecture.sh (신규)

#!/bin/bash
echo "🏗️ Architecture Quality Gates"

# 1. 순환 의존성 검사
echo "① Circular Dependency Check..."
find src -name "*.ts" -o -name "*.svelte" | \
  xargs grep -l "import.*from" | \
  npx depcruise --output-type err-long 2>/dev/null || {
  echo "⚠️ Circular dependencies detected"
}

# 2. 무단 import 검사 (services는 api를 import 하면 안 됨)
echo "② Boundary Violation Check..."
grep -r "import.*from.*routes" src/lib/services/ && {
  echo "❌ FAIL: Services should not import Routes"
  exit 1
} || echo "✓ Services boundary OK"

# 3. 타입 정합성
echo "③ Type Consistency..."
npx tsc --noEmit || exit 1

# 4. 테스트 커버리지 최소값
echo "④ Coverage Gates..."
npm run test:coverage -- --threshold=70 || {
  echo "⚠️ Coverage below 70%"
}

echo "✅ Architecture Validation Complete"
```

### 최적화된 부분

```
✅ COMPLETED (v3.2):
- 도메인 규칙 5개 명확화 (rental, payment, ui-mobile, security-auth, core-rules)
- Agent 역할 분리 (Planner/Generator/Evaluator)
- GATE 단계 명시 (B→C→E)
```

---

## 2️⃣ 도구 배치 (스틸, 훅, 에이전트, MCP 플러그인)

### 현황 평가

**완성도:** 75% ✅

```
✅ 기존:
- Bash, Read, Edit, Grep, Glob 도구 정의
- .husky/pre-commit 훅 선언
- 4개 에이전트 (harness-executor, sp2-tdd-agents, sp3-qa-agent, sp4-deploy-agent)
- MCP 선언 (mcp-servers.json)

⚠️ 부족:
- MCP 실제 구현 (현재는 선언만)
- 고급 훅 (pre-push, commit-msg) 미정의
- 에이전트 간 메시지 전달 프로토콜 (handoff format) 부족
```

### 추가 보완

#### 2.1 고급 훅 추가 (.husky/)

```bash
# .husky/pre-push (신규)
#!/bin/sh

echo "🚀 Pre-Push Validation"

# 1. 원격 변경사항과 충돌 검사
echo "Checking for merge conflicts..."
git diff origin/main..HEAD --name-only | xargs grep -l "^<<<<<<< HEAD" && {
  echo "❌ FAIL: Merge conflicts in staged files"
  exit 1
}

# 2. 커밋 메시지 규칙 (Conventional Commits)
echo "Validating commit messages..."
git log origin/main..HEAD --pretty=%B | grep -E "^(feat|fix|refactor|test|docs|chore)" || {
  echo "⚠️ WARNING: Use Conventional Commits (feat:, fix:, refactor:, etc.)"
}

# 3. 대용량 파일 검사 (>10MB)
echo "Checking file sizes..."
git diff --cached --name-only | while read file; do
  size=$(git cat-file -s :0:"$file" 2>/dev/null)
  if [ "$size" -gt 10485760 ]; then
    echo "❌ FAIL: File too large: $file ($((size/1024/1024))MB)"
    exit 1
  fi
done

echo "✅ Pre-Push Checks Complete"
```

```bash
# .husky/commit-msg (신규)
#!/bin/sh

echo "📝 Commit Message Validation"

MSG=$(cat "$1")

# 1. 커밋 메시지 길이 (50자 이하 제목)
SUBJECT=$(echo "$MSG" | head -n1)
if [ ${#SUBJECT} -gt 50 ]; then
  echo "❌ FAIL: Subject line must be ≤50 chars (yours: ${#SUBJECT})"
  exit 1
fi

# 2. Conventional Commits 형식
if ! echo "$SUBJECT" | grep -qE "^(feat|fix|refactor|test|docs|chore|ci|style|perf)(\([^)]+\))?:"; then
  echo "❌ FAIL: Use format: feat(scope): description"
  exit 1
fi

# 3. 금지 키워드 (WIP, TODO, FIXME 제목에 금지)
if echo "$SUBJECT" | grep -iE "wip|todo|fixme|hack"; then
  echo "⚠️ WARNING: Staging WIP/TODO commit"
fi

echo "✅ Commit Message Valid"
```

#### 2.2 에이전트 Handoff Format

```markdown
# HANDOFF_PROTOCOL.md (신규 — 에이전트 간 전달 규격)

## 에이전트 간 메시지 전달 (Harness → sp2-tdd-agents)

### 형식 (JSON)

```json
{
  "source_agent": "harness-executor",
  "target_agent": "sp2-tdd-agents",
  "task_id": "M3-001",
  "task_type": "TDD",
  "handoff_metadata": {
    "created_at": "2026-06-09T14:30:00Z",
    "session_id": "sess-abc123",
    "token_estimate": 45000,
    "context_files": [
      ".claude/rules/payment.md",
      ".claude/harness/TASK.md"
    ]
  },
  "payload": {
    "task_description": "...",
    "test_requirements": {
      "happy_path": "...",
      "edge_cases": "...",
      "error_scenarios": "..."
    },
    "acceptance_criteria": "..."
  }
}
```

### 구현 예시

```typescript
// harness-executor.md 내부
async function delegateToSp2(taskId: string, taskData: any) {
  const handoff = {
    source_agent: "harness-executor",
    target_agent: "sp2-tdd-agents",
    task_id: taskId,
    task_type: "TDD",
    payload: taskData
  }
  
  // 메시지 전달
  return `@sp2-tdd-agents\n\`\`\`json\n${JSON.stringify(handoff, null, 2)}\n\`\`\``
}
```
```

#### 2.3 MCP v3.2 → v3.3 구현 로드맵

```
v3.2: 선언만 완료 ✅
├── mcp-servers.json 정의
├── 인증 관리 규칙
└── 제약 조건 명시

v3.3: Supabase MCP 구현 (예상 2주)
├── supabase-rpc-wrapper (RPC 안전 호출)
├── postgres-schema-explorer (스키마 탐색)
└── webhook-signature-validator (결제 검증)

v3.4: Playwright MCP (예상 3주)
├── ui-screenshot-taker (렌더링 확인)
├── responsive-test-runner (모바일 테스트)
└── accessibility-validator (a11y 검증)

v3.5: GitHub MCP (예상 2주)
├── pr-auto-generator (자동 PR 생성)
├── issue-auto-commenter (결과 자동 보고)
└── release-note-builder (릴리스 노트 자동)
```

### 최적화된 부분

```
✅ COMPLETED (v3.2):
- 4개 에이전트 역할 명시
- GATE 단계별 도구 정의
- MCP 서버 공식 선언 (mcp-servers.json)
- PII Shield 미들웨어 구현 (마스킹 패턴)
- Tool Budget 가이드 (필요 도구만 선택)
```

---

## 3️⃣ 경계 설정

### 현황 평가

**완성도:** 85% ✅

```
✅ COMPLETED:
- 직접 INSERT 금지 (RPC 경유) → H-01
- 클라이언트 가격 계산 금지 → H-02  
- 웹훅 동기 처리 금지 → H-03
- 만료 필터 필수 → H-04
- 서버 키 격리 → H-05
- any 타입 금지 → H-06

⚠️ FINE-TUNING 필요:
- 경계 위반 자동 감지 (Grep 규칙화)
- 경계 초과 시 자동 차단 (Pre-commit 훅)
```

### 추가 보완

#### 3.1 경계 자동 감지 규칙

```yaml
# .claude/harness/boundary-rules.yaml (신규)

rules:
  h_01_rpc_only:
    pattern: "await supabase.from('rental_reservations').insert"
    severity: ERROR
    message: "❌ Direct INSERT forbidden. Use atomic_reserve_asset RPC instead."
    file_types: ["ts", "tsx"]
    
  h_02_server_calc:
    pattern: "const .*price.*=.*\\*\\s*(0\\.[0-9]|[0-9])"
    severity: ERROR
    message: "❌ Client-side price calculation forbidden. Use calculate_cart_total RPC."
    
  h_03_webhook_sync:
    pattern: "POST.*webhook.*=>.*await.*calculate.*return.*200"
    severity: ERROR
    message: "❌ Synchronous webhook processing forbidden. Return 200 immediately, use pg_cron."
    
  h_04_expires_filter:
    pattern: "\\.(in|or)\\s*\\(.*status.*\\).*(?!expires_at)"
    severity: WARNING
    message: "⚠️ Availability query missing expires_at filter. Will include expired HOLDs."
    
  h_05_secret_key_exposure:
    pattern: "import.*\\{.*TOSS_SECRET_KEY.*\\}.*from.*'\\$env/static/public'"
    severity: ERROR
    message: "❌ Server key exposed to client. Use $env/static/private instead."
    
  h_06_any_type:
    pattern: ":\\s*any"
    severity: ERROR
    message: "❌ 'any' type forbidden. Use explicit types or type guards."

# Pre-commit 자동 적용
auto_check:
  enabled: true
  trigger: git_pre_commit
  fail_on: ERROR
  warn_on: WARNING
```

#### 3.2 Pre-commit에서 자동 검사

```bash
# 업데이트된 .husky/pre-commit

# ... 기존 npm run check, lint 실행 ...

# NEW: Boundary Rules 자동 검사
echo "🚧 Boundary Rules Check..."
npm run boundary:check || {
  echo "❌ FAIL: Boundary violations detected"
  exit 1
}
```

```typescript
// package.json에 추가
{
  "scripts": {
    "boundary:check": "node scripts/boundary-validator.js"
  }
}

// scripts/boundary-validator.js (신규)
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const rules = yaml.load(fs.readFileSync('.claude/harness/boundary-rules.yaml', 'utf8')).rules
const srcDir = 'src'

let violations = []

for (const [ruleId, rule] of Object.entries(rules)) {
  const regex = new RegExp(rule.pattern, 'gm')
  const files = getAllFiles(srcDir)
  
  files.forEach(file => {
    if (!rule.file_types.includes(path.extname(file).slice(1))) return
    
    const content = fs.readFileSync(file, 'utf8')
    const matches = content.match(regex)
    
    if (matches) {
      violations.push({
        rule: ruleId,
        severity: rule.severity,
        message: rule.message,
        file: file,
        count: matches.length
      })
    }
  })
}

if (violations.filter(v => v.severity === 'ERROR').length > 0) {
  console.error('❌ Boundary Violations:')
  violations.forEach(v => console.error(`  ${v.file}: ${v.message}`))
  process.exit(1)
}
```

### 최적화된 부분

```
✅ COMPLETED (v3.2):
- 6개 절대 금지 패턴 (H-01~H-06) 명시
- AGENTS.md에 패턴 예시 코드
- middleware-guards.md에 상세 설명
- RLS 정책 + 웹훅 서명 검증 규칙
```

---

## 4️⃣ 세션별 맥락 관리

### 현황 평가

**완성도:** 65% ⚠️

```
✅ 기존:
- TASK.md (현재 태스크 상태)
- GSD_LOG.md (실행 이력)
- Learning Directory (.harness/learnings/)

❌ 부족:
- 세션 메모리 (과거 세션에서 배운 교훈)
- 점진적 노출 규칙 (Progressive Disclosure)
- 주기적 점검 스케줄 (Health Check)
- 컨텍스트 리셋 프로토콜 (Context Reset)
```

### 추가 보완

#### 4.1 세션 메모리 구조 (선택)

```
.claude/memory/              ← NEW: 장기 메모리
├── user_profile.md          ← 사용자 역할·선호도
├── project_context.md       ← 프로젝트 상태·제약
├── domain_learnings/        ← 도메인별 교훈
│   ├── rental_patterns.md   ← M2 예약 패턴 누적
│   ├── payment_gotchas.md   ← M3 결제 함정
│   └── svelte5_tips.md      ← SvelteKit 5 팁
└── session_history.md       ← 세션 요약 (선택)
```

#### 4.2 Progressive Disclosure 자동화

```typescript
// .claude/harness/context-loader.ts (신규)

export async function loadContextByDomain(domain: string): Promise<string[]> {
  const filesToLoad = [
    'core-rules.md',  // 항상
  ]
  
  // 도메인별 추가 로드
  const domainMap: Record<string, string[]> = {
    'm2_rental': ['rental.md', 'rental_patterns.md'],
    'm3_payment': ['payment.md', 'payment_gotchas.md'],
    'ui': ['ui-mobile.md'],
    'auth': ['security-auth.md'],
  }
  
  if (domain in domainMap) {
    filesToLoad.push(...domainMap[domain])
  }
  
  // 최근 에러 있으면 자동 로드
  const recentErrors = await getRecentLearnings()
  filesToLoad.push(...recentErrors)
  
  return filesToLoad
}

// 사용 예시 (harness-executor에서)
const taskDomain = analyzeDomain(task)  // 'm2_rental' 감지
const contextFiles = await loadContextByDomain(taskDomain)
// → ['core-rules.md', 'rental.md', 'rental_patterns.md', 'compile_error.md']
```

#### 4.3 주기적 점검 (Health Check)

```bash
# scripts/harness-health-check.sh (신규)

#!/bin/bash
echo "🏥 Harness Health Check"

# 1. 학습 디렉터리 크기 (과도하면 정리 경고)
LEARNINGS_SIZE=$(du -sh .claude/harness/learnings | cut -f1)
echo "Learning Directory: $LEARNINGS_SIZE"
if [ $(du -s .claude/harness/learnings | cut -f1) -gt 5000 ]; then
  echo "⚠️ Learning directory > 5MB. Consider archiving old files."
fi

# 2. TASK.md 나이 확인 (1주 이상 미수정이면 경고)
TASK_AGE=$(date -r .claude/harness/TASK.md +%s)
NOW=$(date +%s)
AGE_DAYS=$(( (NOW - TASK_AGE) / 86400 ))
if [ $AGE_DAYS -gt 7 ]; then
  echo "⚠️ TASK.md not updated for $AGE_DAYS days"
fi

# 3. 미완료 태스크 확인
OPEN_TASKS=$(grep -c "^- \[ \]" .claude/harness/TASK.md)
if [ $OPEN_TASKS -gt 20 ]; then
  echo "⚠️ $OPEN_TASKS open tasks. Consider consolidation."
fi

# 4. 경계 규칙 유효성
npm run boundary:check --silent || echo "⚠️ Boundary violations exist"

# 5. 에이전트 정의 최신성
ls -lt .claude/agents/*.md | head -1 | awk '{print "Latest agent update: " $NF}'

echo "✅ Health Check Complete"
```

#### 4.4 Context Reset Protocol

```markdown
# CONTEXT_RESET.md (신규 — 장기 세션 용)

## 언제 리셋하는가?

- **토큰 한계 도달:** 현재 컨텍스트 > 100k 토큰
- **세션 길이:** 8시간 이상
- **복잡도:** 10개 이상의 NOW 태스크 완료

## 리셋 절차

### Step 1: Handoff 문서 작성

```markdown
# HANDOFF.md (자동 생성)

## 진행 상황
- 완료: [태스크 1-5] (커밋됨)
- 진행 중: [태스크 6] (80%)
- 예정: [태스크 7-10]

## 주의 사항
- [이슈 1] 해결됨 → 수정 파일: src/lib/payment.ts:line 42
- [이슈 2] 남아있음 → 원인: Supabase RLS 권한 문제

## 컨텍스트 핵심
- 현재 도메인: M3 (Payment)
- 적용 규칙: payment.md + security-auth.md
- 최근 에러: compile_error.md 참조

## 다음 작업
1. [태스크 6] 완료 + GATE C
2. [태스크 7] GREEN 단계 시작
```

### Step 2: 새 세션 시작

```
[새 세션 시작]

메시지:
"이전 세션에서 다음을 진행했습니다: [HANDOFF.md 요약]
계속해서 [태스크 6]을 진행해주세요."

→ AI가 HANDOFF.md 자동 로드 + 컨텍스트 복구
→ 토큰 절약: 기존 60% 감소
```

---

## 5️⃣ 실행 계획 관리

### 현황 평가

**완성도:** 95% ✅

```
✅ COMPLETED:
- TASK.md 구조 (NOW/NEXT/DONE/BLOCKED/BACKLOG)
- GATE 단계 명시 (B→C→E)
- TDD 태스크 15분 단위 분해
- GSD_LOG.md (실행 이력)

✅ v3.2 추가:
- Self-Correction Runner (자동 재시도)
- Learning Directory (패턴 학습)
- Handoff Protocol (세션 인수인계)
```

### 최적화 사항

```
✅ ALREADY DONE (v3.2):
- 계획 단계: @harness-executor (Planner)
- 실행 단계: @harness-executor / @sp2-tdd-agents (Generator)
- 검증 단계: @sp3-qa-agent (Evaluator)

✅ AUTO-CORRECTION:
- npm run check 자동 실행 후 실패 시 피드백
- .harness/learnings/에 에러 자동 저장
- 에이전트 다음 턴에 자동 로드 + 수정 시도
```

---

## 6️⃣ 오케스트레이션 패턴 + 자율 실험 루프

### 현황 평가

**완성도:** 50% ⚠️ (선언만 완료)

```
✅ 선언:
- 3-Tier Orchestration (Planner/Generator/Evaluator)
- ARCHITECTURE.md에 명시
- 역할 분리 원칙

❌ 구현:
- 실제 오케스트레이션 엔진 없음 (수동 GATE 의존)
- 자율 실험 루프 미정의
- 다중 경로 선택 (A/B 테스트) 메커니즘 없음
```

### 추가 보완

#### 6.1 자율 오케스트레이션 엔진 (선택 구현)

```typescript
// .claude/harness/orchestration-engine.ts (신규, 향후 MCP 통합)

interface OrchestrationConfig {
  taskId: string
  domain: string
  complexity: 'simple' | 'medium' | 'complex'
  dependencies: string[]
}

interface OrchestratorState {
  phase: 'planning' | 'generating' | 'verifying' | 'complete'
  current_agent: string
  execution_log: any[]
  gates_passed: string[]
}

export class AutoOrchestrator {
  private state: OrchestratorState = {
    phase: 'planning',
    current_agent: 'harness-executor',
    execution_log: [],
    gates_passed: []
  }
  
  async orchestrate(config: OrchestrationConfig): Promise<void> {
    // Phase 1: Planner (harness-executor)
    console.log(`📋 PHASE 1: Planning [${config.taskId}]`)
    const plan = await this.runPlanner(config)
    
    // GATE B 자동화 (향후)
    // → 현재는 수동 (Stephen 승인)
    
    // Phase 2: Generator (harness-executor / sp2-tdd-agents)
    console.log(`🔨 PHASE 2: Generating`)
    const isDDD = this.shouldEnableTDD(config.domain)
    const generator = isDDD ? 'sp2-tdd-agents' : 'harness-executor'
    
    const code = await this.runGenerator(generator, plan)
    
    // Self-Correction Loop (LAYER 5)
    const validated = await this.validateWithAutoCorrection(code)
    if (!validated) {
      console.log(`⚠️ Auto-correction failed. Escalating to GATE C`)
      return  // Stephen의 개입 필요
    }
    
    // Phase 3: Evaluator (sp3-qa-agent)
    console.log(`✅ PHASE 3: Verifying`)
    const qaPass = await this.runEvaluator(code, plan)
    
    if (qaPass) {
      this.state.phase = 'complete'
      console.log(`🎉 ORCHESTRATION COMPLETE [${config.taskId}]`)
    }
  }
  
  private async validateWithAutoCorrection(code: any): Promise<boolean> {
    let attempts = 0
    while (attempts < 3) {
      const result = await this.runTypeCheck()
      if (result.success) return true
      
      attempts++
      console.log(`Auto-correction attempt ${attempts}/3`)
      // 에러를 .harness/learnings에 저장
      // 에이전트에 피드백 주입
    }
    return false
  }
  
  // ... 기타 메서드
}
```

#### 6.2 자율 실험 루프 (A/B 테스트 패턴)

```markdown
# AUTONOMOUS_EXPERIMENTATION.md (신규, 향후 구현)

## 목표
코드 품질·성능·사용성을 자동으로 개선하는 A/B 테스트 루프

## 패턴 1: 구현 전략 A/B 테스트

```
[태스크] calculate_cart_total 성능 최적화

Option A: 데이터베이스 조인 최적화
  - 예상 성능: 50ms → 20ms
  - 구현 난도: 중

Option B: 캐싱 레이어 추가
  - 예상 성능: 50ms → 5ms (캐시 히트 시)
  - 구현 난도: 고

→ 에이전트가 양쪽 구현 → 테스트 성능 비교 → 더 나은 것 선택
```

## 패턴 2: UI 사용성 테스트

```
[태스크] 예약 폼 UI 개선

Variant A: 단계식 (Step 1: 날짜 → Step 2: 옵션)
Variant B: 한 화면 (모든 필드 한 번에)

→ Playwright로 양쪽 렌더링 + 시각적 비교
→ 모바일 반응성 자동 검증
→ 접근성 점수 비교
→ 더 나은 UX 선택
```

## 패턴 3: 성능 회귀 감지

```
[자동 주기 실행]

매 주마다:
1. Lighthouse 점수 측정 (main branch)
2. 현재 branch와 비교
3. 점수 하락 감지 → 자동 경고
4. 병목 지점 분석 → 최적화 제안
```
```

#### 6.3 다중 경로 선택 메커니즘 (확률적 선택)

```typescript
// 결정 트리: TDD vs GSD 판별

interface TaskDecision {
  domain: string
  complexity: number
  riskLevel: number
  recommendedPath: 'TDD' | 'GSD'
  confidence: number  // 0.0 ~ 1.0
}

function decidePath(domain: string, description: string): TaskDecision {
  const score = {
    keywords_payment: description.includes('payment|결제|환불') ? 10 : 0,
    keywords_reservation: description.includes('reservation|예약|동시성') ? 10 : 0,
    keywords_auth: description.includes('auth|권한|RLS') ? 8 : 0,
    complexity_multi_file: countChangedFiles() > 3 ? 5 : 0,
    risk_level: computeRisk(domain) * 10
  }
  
  const tddScore = Object.values(score).reduce((a, b) => a + b, 0)
  const gsdScore = 100 - tddScore
  
  return {
    domain,
    complexity: countChangedFiles(),
    riskLevel: computeRisk(domain),
    recommendedPath: tddScore > gsdScore ? 'TDD' : 'GSD',
    confidence: Math.max(tddScore, gsdScore) / 100
  }
}

// 사용 예시
const decision = decidePath('m3_payment', taskDescription)
if (decision.confidence < 0.6) {
  console.log(`⚠️ Ambiguous: ${decision.recommendedPath} (${decision.confidence*100}%)`)
  console.log(`Consider: ${decision.recommendedPath === 'TDD' ? 'GSD' : 'TDD'} as alternative`)
}
```

### 현황 요약

```
현재 v3.2: GATE 기반 수동 오케스트레이션
향후 v3.4: 자율 오케스트레이션 엔진 (선택 구현)
향후 v3.5: 자율 실험 루프 + A/B 테스트
```

---

## 7️⃣ 검증 규칙과 원칙 설계

### 현황 평가

**완성도:** 85% ✅

```
✅ COMPLETED:
- 7가지 Middleware Guards (middleware-guards.md)
- 6개 절대 금지 패턴 (H-01~H-06)
- 도메인별 검증 규칙 (rental.md, payment.md, etc.)
- sp3-qa-agent 3단계 검수 프로토콜

⚠️ FINE-TUNING:
- 검증 규칙의 자동 Grep 화 (boundary-rules.yaml)
- 경계 위반 Pre-commit 자동 차단
```

### 최적화 요약

```
✅ ALREADY DONE (v3.2):
- Self-Correction Runner (컴파일/테스트 실패 자동 피드백)
- Rule Compliance Check (grep으로 금지 패턴 자동 검사)
- Learning Directory (패턴 누적 → 재사용)
- QA 3단계 검증 (규칙/기술부채/S2 기준)
```

---

## 8️⃣ 자가 개선 루프

### 현황 평가

**완성도:** 75% ✅ (신규 v3.2)

```
✅ NEW in v3.2:
- Learning Directory (.harness/learnings/)
- Self-Correction Runner (자동 재시도 + 피드백)
- Compile Gate (Pre-commit 훅)
- Auto-Feedback Injection (에러 → 에이전트 로드)

✅ v3.2 신기능:
- compile_error.md 자동 생성
- test_error.md 자동 생성
- green_compile_error.md 자동 생성
- [도메인]_patterns.md 누적

❌ 부족:
- 통계 기반 개선 (무엇이 가장 자주 실패하는가?)
- 메타 분석 (에이전트 성능 지표)
- 자동 규칙 갱신 (새로운 패턴 감지 시)
```

### 추가 보완

#### 8.1 통계 기반 개선 분석

```typescript
// scripts/analyze-learnings.ts (신규)

interface LearningStats {
  total_errors: number
  by_type: Record<string, number>
  by_domain: Record<string, number>
  most_frequent: string
  recently_fixed: string
  recurring_issues: string[]  // 3회 이상
}

async function analyzeLearnings(): Promise<LearningStats> {
  const files = fs.readdirSync('.claude/harness/learnings')
  const stats: LearningStats = {
    total_errors: 0,
    by_type: {},
    by_domain: {},
    most_frequent: '',
    recently_fixed: '',
    recurring_issues: []
  }
  
  // 분석 로직
  files.forEach(file => {
    const content = fs.readFileSync(path.join('.claude/harness/learnings', file), 'utf8')
    const type = extractErrorType(content)  // compile|test|type 등
    stats.by_type[type] = (stats.by_type[type] || 0) + 1
    
    const domain = extractDomain(file)  // rental|payment|ui 등
    stats.by_domain[domain] = (stats.by_domain[domain] || 0) + 1
  })
  
  return stats
}

// 사용 예시
async function generateMonthlyReport() {
  const stats = await analyzeLearnings()
  console.log(`
📊 Monthly Harness Report
=========================
Total Errors: ${stats.total_errors}
Most Frequent: ${stats.most_frequent}
Recurring (3+): ${stats.recurring_issues.join(', ')}

By Type:
${Object.entries(stats.by_type).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

By Domain:
${Object.entries(stats.by_domain).map(([k, v]) => `  ${k}: ${v}`).join('\n')}
  `)
}
```

#### 8.2 자동 규칙 갱신 (메타 학습)

```markdown
# AUTO_RULE_UPDATE.md (신규, 선택 구현)

## 패턴: 반복된 오류 → 새 규칙 자동 생성

```
[이벤트] 같은 에러가 3회 발생

1. Learning Directory에서 패턴 추출
   → "타입스크립트 'any' 타입 사용" (3회)

2. 규칙 후보 자동 제안
   → boundary-rules.yaml에 추가할 신규 규칙 제안

3. Stephen 승인 후 규칙 활성화
   → Pre-commit 훅에 추가됨
   → 향후 자동 감지

예시:
  발생: "Cannot read property 'transaction_id' of undefined"
  원인: PaymentResult 타입 미정의
  규칙: "payment domain에서는 모든 RPC 반환값에 타입 정의 필수"
  추가: payment.md에 "Type Guard Pattern" 섹션 추가
```

#### 8.3 에이전트 성능 지표

```yaml
# .claude/harness/agent-metrics.yaml (신규, 자동 수집)

metrics:
  harness_executor:
    total_tasks: 124
    success_rate: 0.92
    avg_gates_per_task: 1.3
    most_common_rejection: "범위 초과"
    
  sp2_tdd_agents:
    red_success_rate: 0.98
    green_success_rate: 0.95
    refactor_duration_avg: 12  # 분
    
  sp3_qa_agent:
    pass_rate: 0.88
    most_common_issue: "console.log 잔류"
    
  auto_correction:
    retry_success_rate: 0.75
    max_retries_hit: 12  # 3회 재시도 실패
```

---

## 📊 종합 평가 매트릭스

| 항목 | v3.1 | v3.2 | v3.3+ | 최적 |
|------|------|------|-------|-----|
| **프로젝트 구조** | 60% | 65% | 85% | 100% |
| **도구 배치** | 70% | 75% | 90% | 100% |
| **경계 설정** | 80% | 85% | 95% | 100% |
| **세션 맥락** | 50% | 65% | 80% | 100% |
| **실행 계획** | 90% | 95% | 100% | 100% |
| **오케스트레이션** | 20% | 50% | 75% | 100% |
| **검증 규칙** | 80% | 85% | 95% | 100% |
| **자가 개선** | 30% | 75% | 90% | 100% |
| **평균** | **60%** | **74%** | **89%** | **100%** |

---

## 🎯 다음 단계 (Priority Order)

### P0 (즉시 — 1주)
- [x] ARCHITECTURE.md 작성 (완료)
- [x] middleware-guards.md 작성 (완료)
- [ ] boundary-rules.yaml 작성 (새로운 파일)
- [ ] boundary-validator.js 구현

### P1 (2-3주)
- [ ] .husky/pre-push 구현
- [ ] .husky/commit-msg 구현
- [ ] HANDOFF_PROTOCOL.md 작성
- [ ] 실제 M3 태스크에서 v3.2 검증

### P2 (1개월)
- [ ] MCP v3.3 (Supabase) 구현
- [ ] Context Reset Protocol 운영
- [ ] Health Check 스크립트 활성화

### P3 (향후)
- [ ] Orchestration Engine (v3.4)
- [ ] Autonomous Experimentation (v3.5)
- [ ] Meta-learning Rules Update

---

## 📚 참고 자료

```
.claude/harness/
├── ARCHITECTURE.md              ← 5계층 아키텍처
├── middleware-guards.md         ← 7가지 보안 가드
├── mcp-servers.json             ← MCP 선언
├── HARNESS_UPGRADE_SUMMARY.md   ← v3.1→v3.2 요약
└── ENTERPRISE_INTEGRATION_v3.2.md (이 파일)

.claude/rules/
├── core-rules.md
├── rental.md
├── payment.md
├── ui-mobile.md
└── security-auth.md
```

---

*ENTERPRISE_INTEGRATION_v3.2.md*
*8대 항목별 보완 + 로드맵*
*2026-06-09*
