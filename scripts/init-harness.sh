#!/usr/bin/env bash
# scripts/init-harness.sh
# ─────────────────────────────────────────────────────────────────────────────
# Enterprise Harness Flow 부트스트래핑 스크립트
# 다른 프로젝트에 Harness Flow를 도입할 때 이 스크립트를 실행.
#
# 사용법:
#   bash scripts/init-harness.sh                     # 대화형 모드
#   bash scripts/init-harness.sh --project my-app    # 비대화형 모드
#   bash scripts/init-harness.sh --help
#
# 생성 항목:
#   .claude/harness/{TASK,GSD_LOG,ROLLBACK_LOG}.md
#   .claude/harness/{context-hook,middleware-guards,ARCHITECTURE,ERROR_TAXONOMY}.md
#   .claude/harness/learnings/.gitkeep
#   .claude/agents/{harness-executor,promptor}.md
#   .claude/agents/shared/{sp2-tdd-agents,sp3-qa-agent,sp4-deploy-agent}.md
#   .claude/rules/{core-rules,frontend-standards,security-compliance}.md
#   AGENTS.md (루트 헌장)
#   CLAUDE.md (세션 시작 가이드)
#   .husky/pre-commit (가드레일)
#
# 주의: 이미 존재하는 파일은 덮어쓰지 않음 (--force로 강제 덮어쓰기)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── 색상 코드 ──────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

# ── 기본값 ─────────────────────────────────────────────────────────────────────
PROJECT_NAME=""
FORCE=false
STACK="sveltekit"   # 기본 스택: sveltekit | nextjs | nuxt | generic
DRY_RUN=false

# ── 도움말 ─────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF

${BOLD}Enterprise Harness Flow 부트스트래핑 스크립트${RESET}

사용법:
  bash scripts/init-harness.sh [OPTIONS]

OPTIONS:
  --project NAME    프로젝트 이름 (AGENTS.md에 사용)
  --stack STACK     기술 스택 선택: sveltekit | nextjs | nuxt | generic
                    (기본값: sveltekit)
  --force           기존 파일 덮어쓰기
  --dry-run         실제 파일 생성 없이 목록만 출력
  -h, --help        이 도움말 출력

예시:
  bash scripts/init-harness.sh --project my-app --stack nextjs
  bash scripts/init-harness.sh --force
EOF
  exit 0
}

# ── 인수 파싱 ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT_NAME="$2"; shift 2 ;;
    --stack)   STACK="$2"; shift 2 ;;
    --force)   FORCE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo -e "${RED}알 수 없는 옵션: $1${RESET}"; usage ;;
  esac
done

# ── 대화형 입력 ────────────────────────────────────────────────────────────────
if [[ -z "$PROJECT_NAME" ]]; then
  echo -e "${CYAN}프로젝트 이름을 입력하세요 (엔터 = 현재 디렉터리명):${RESET} "
  read -r PROJECT_NAME
  PROJECT_NAME="${PROJECT_NAME:-$(basename "$(pwd)")}"
fi

# ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────
write_file() {
  local path="$1"
  local content="$2"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "  ${CYAN}[DRY-RUN]${RESET} 생성 예정: $path"
    return
  fi

  if [[ -f "$path" && "$FORCE" == "false" ]]; then
    echo -e "  ${YELLOW}⏭ 건너뜀 (이미 존재):${RESET} $path"
    return
  fi

  mkdir -p "$(dirname "$path")"
  printf '%s' "$content" > "$path"
  echo -e "  ${GREEN}✔ 생성:${RESET} $path"
}

# ── 시작 ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║  🚀 Enterprise Harness Flow 초기화        ║${RESET}"
echo -e "${BOLD}${CYAN}║  프로젝트: ${PROJECT_NAME}${RESET}"
echo -e "${BOLD}${CYAN}║  스택: ${STACK}${RESET}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════╝${RESET}"
echo ""

# ── Step 1: 디렉터리 구조 ──────────────────────────────────────────────────────
echo -e "${YELLOW}[1/5] 하네스 폴더 스캐폴딩 생성 중...${RESET}"

if [[ "$DRY_RUN" == "false" ]]; then
  mkdir -p \
    .claude/harness/learnings \
    .claude/harness/telemetry \
    .claude/agents/shared \
    .claude/rules \
    scripts
  touch .claude/harness/learnings/.gitkeep
  echo -e "  ${GREEN}✔ 폴더 구조 생성 완료${RESET}"
else
  echo -e "  ${CYAN}[DRY-RUN]${RESET} .claude/, scripts/ 폴더 생성 예정"
fi

# ── Step 2: AGENTS.md (루트 헌장) ──────────────────────────────────────────────
echo -e "${YELLOW}[2/5] AGENTS.md 루트 헌장 생성 중...${RESET}"

write_file "AGENTS.md" "# AGENTS.md — ${PROJECT_NAME}
# Harness Flow v3.2 | Enterprise Agent Constitution
# \"자동이 막고, 사람이 방향을 잡는다.\"

---

## 프로젝트 정체성

\`\`\`
서비스명   : ${PROJECT_NAME}
스택       : [YOUR STACK HERE]
개발방식   : AI 에이전틱 코딩 | Claude Code | Harness Flow v3.2
\`\`\`

---

## 1. Execution Pipeline

\`\`\`
PLAN-FIRST        : src/ 파일 수정 전 TASK.md에 계획 작성 + GATE B 승인 필수
CONTINUOUS VERIFY : 로직 수정 후 npm run check 자동 실행 (최대 3회 Self-Correction)
PROGRESSIVE LOAD  : 작업 전 관련 .claude/rules/*.md 파일 먼저 로드
GATE PROTOCOL     : GATE B (계획) → GATE C (구현) → GATE E (QA) → 커밋
\`\`\`

---

## 2. Terminal Safety Protocols

\`\`\`
금지 명령 : ssh 직접 접속, 프록시 없는 curl/wget, iptables 직접 조작
에러 처리 : non-zero exit → 즉시 중단 → stderr 저장 → Self-Correction Loop
최대 재시도: Class B 에러 3회 / Class A 에러 5회
\`\`\`

---

## 3. Self-Correction Loop + Error Taxonomy

\`\`\`
Class A (Transient)    : API Rate Limit, 네트워크 타임아웃 → Backoff 자동 재시도 (5회)
Class B (Deterministic): 컴파일·린트·테스트 실패 → Self-Correction (3회)
Class C (Semantic)     : 요구사항 불명확, QA 3회 연속 REJECT → Stephen 에스컬레이션
Class D (Critical)     : 보안 위반, 가드레일 수정 시도 → 즉시 세션 종료

상세: .claude/harness/ERROR_TAXONOMY.md
\`\`\`

---

## 4. Progressive Domain Rules Loading

\`\`\`
모든 태스크   : .claude/rules/core-rules.md (필수)
프론트엔드    : .claude/rules/frontend-standards.md
DB 변경       : .claude/rules/database-migrations.md
보안          : .claude/rules/security-compliance.md
\`\`\`

---

## 5. 황금 원칙

\`\`\`
GP-1.  git 명령어는 사람만 실행 (add / commit / push 전부)
GP-2.  GATE는 CRITICAL 등급만 발동 — ROUTINE은 자율 처리
GP-3.  AI는 제안·실행, 결정은 사람
GP-4.  TDD 도메인은 테스트 없이 구현 코드 작성 금지
GP-5.  불확실하면 즉시 멈추고 질문 (ROUTINE은 예외)
GP-6.  명시 범위 밖 기능 선제 구현 금지 (Default-Exclude 원칙)
GP-7.  GATE 질문은 서비스 의도 언어로만 — 기술 용어 인간에게 노출 금지
GP-8.  오인 발생 시 HOOK-7 즉시 실행 → misidentifications.md 기록 필수
GP-9.  BLOCKED 2일+ 지속 시 HOOK-8 자동 발동 → Skip/대기/대안 제시
\`\`\`

---

## 6. 에이전트 호출 순서

\`\`\`
[B-START] → @harness-executor (Planner: TASK.md 생성)
          → GATE B (사람 승인)
          → GSD: @harness-executor (Generator)
          → TDD: @sp2-tdd-agents (RED→GREEN→REFACTOR)
          → GATE C 반복
          → @sp3-qa-agent (Evaluator: QA 검수)
          → GATE E (사람 승인)
          → git commit (사람 직접)
          → @sp4-deploy-agent (배포 체크리스트)

대형 아젠다: @promptor → TASK.md → @harness-executor
\`\`\`

---

*AGENTS.md v3.2 | Harness Flow | ${PROJECT_NAME}*
"

# ── Step 3: CLAUDE.md (세션 시작 가이드) ──────────────────────────────────────
echo -e "${YELLOW}[3/5] CLAUDE.md 세션 가이드 생성 중...${RESET}"

write_file "CLAUDE.md" "# CLAUDE.md — ${PROJECT_NAME} 세션 시작 가이드
# Harness Flow v3.2 | 모든 세션에서 자동 로드

---

## 이 프로젝트는

\`\`\`
서비스명   : ${PROJECT_NAME}
스택       : [YOUR STACK HERE]
목표       : [YOUR GOAL HERE]
워크플로우 : Harness Flow v3.2 (반자동화 AI 에이전틱 개발)
\`\`\`

---

## 세션 시작 시 반드시 확인

\`\`\`
1. .claude/harness/TASK.md → 현재 NOW / DONE / BLOCKED 상태
2. .claude/harness/GSD_LOG.md → 마지막 완료 태스크와 수정 파일
3. AGENTS.md → 황금 원칙 + Error Taxonomy + 에이전트 호출 순서
4. .claude/harness/HANDOFF.md → 세션 이관 문서 (있을 경우)
\`\`\`

---

## 현재 진행 상태

\`\`\`
[ 여기에 S-트랙 진행 상황 기입 ]
\`\`\`

---

## 에이전트 호출 규칙

\`\`\`
[B-START] 입력 → @harness-executor (일반 아젠다)
대형 아젠다    → @promptor → TASK.md 생성 → @harness-executor
TDD 태스크     → @harness-executor가 @sp2-tdd-agents에 위임
GATE C 완료    → @sp3-qa-agent (검수)
GATE E 통과    → @sp4-deploy-agent (배포 체크리스트)
오인 발생 시   → HOOK-7 자동 → misidentifications.md 기록
막힌 항목 스킵 → "스킵" 입력 → HOOK-8 실행
\`\`\`

## GATE 등급 원칙 (비개발자 인간 승인자 맞춤)

\`\`\`
🔴 CRITICAL (핵심) → 서비스 의도 확인 필수 (기획 의도 질문 형식)
🟡 BOUNDARY (경계) → "계속할까요?" 한 줄 확인
🟢 ROUTINE  (일반) → 자동 진행 + 결과 보고만

모든 GATE 질문은 서비스·고객 경험 언어로 (기술 용어 금지)
\`\`\`

---

## 절대 기억할 것

\`\`\`
❌ git 명령어 자율 실행 금지 (사람만)
❌ CRITICAL GATE 없이 핵심 도메인 태스크 완료 금지
❌ TDD 도메인에서 테스트 없이 구현 코드 작성 금지
❌ GATE 질문에 기술 용어 사용 금지 (서비스 의도 언어만)
❌ 오인 발생 후 misidentifications.md 기록 없이 재구현 금지
\`\`\`

---

## 도메인 규칙 파일

\`\`\`
.claude/rules/core-rules.md         ← 개발 실행 원칙
.claude/rules/frontend-standards.md ← 프론트엔드 기준
.claude/rules/security-compliance.md← 보안·인증
\`\`\`

---

*CLAUDE.md | Harness Flow v3.2 | ${PROJECT_NAME}*
"

# ── Step 4: Husky Pre-commit 훅 ────────────────────────────────────────────────
echo -e "${YELLOW}[4/5] Git 훅 설치 중...${RESET}"

if ! command -v npm &>/dev/null; then
  echo -e "${RED}  ⚠ npm을 찾을 수 없습니다. 훅 설치를 건너뜁니다.${RESET}"
else
  if [[ "$DRY_RUN" == "false" ]]; then
    npx husky init 2>/dev/null || true
  fi

  write_file ".husky/pre-commit" '#!/bin/sh
# .husky/pre-commit — Harness Flow Gatekeeper
# 엔터프라이즈 하네스 마스터 가이드 ch.9 구현체

echo "🛡️  Harness Gatekeeper 활성화..."

# ── Guard 1: TypeScript 컴파일 ──────────────────────────────────────────────
npm run check 2>&1 | tee /tmp/harness_compile.log
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  echo "❌ [Class B] TypeScript 컴파일 실패."
  echo "📁 로그: .claude/harness/learnings/compile_error.md에 저장 권장"
  exit 1
fi

# ── Guard 2: ESLint ─────────────────────────────────────────────────────────
npm run lint -- --max-warnings=0 2>&1 | tee /tmp/harness_lint.log
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  echo "❌ [Class B] ESLint 실패. 코드 스타일 위반."
  exit 1
fi

# ── Guard 3: 서버 키 클라이언트 노출 방지 ───────────────────────────────────
# (프로젝트에 맞게 키 이름 수정 필요)
CHANGED=$(git diff --cached --name-only | grep -E '\.(ts|svelte|tsx)$' || true)
if [ -n "$CHANGED" ]; then
  for file in $CHANGED; do
    if grep -qE "(SECRET_KEY|PRIVATE_KEY|SERVICE_ROLE)" "$file" 2>/dev/null; then
      if grep -qE "static/public" "$file" 2>/dev/null; then
        echo "❌ [Class D] CRITICAL: 서버 키가 public import에서 발견됨: $file"
        exit 1
      fi
    fi
  done
fi

# ── Guard 4: 변경 파일 단위 테스트 ─────────────────────────────────────────
if [ -n "$CHANGED" ]; then
  echo "🧪 변경 파일 테스트 실행 중..."
  npx jest --bail --findRelatedTests $CHANGED 2>/dev/null || {
    echo "❌ [Class B] 관련 테스트 실패."
    exit 1
  }
fi

echo "✅ Harness Gatekeeper: 모든 가드레일 통과."
'

  if [[ "$DRY_RUN" == "false" ]]; then
    chmod +x .husky/pre-commit 2>/dev/null || true
  fi
fi

# ── Step 5: 핵심 하네스 파일 ──────────────────────────────────────────────────
echo -e "${YELLOW}[5/5] 핵심 하네스 파일 생성 중...${RESET}"

# TASK.md
write_file ".claude/harness/TASK.md" "# TASK.md — ${PROJECT_NAME}
생성일: $(date '+%Y-%m-%d %H:%M')
아젠다: (B-START 실행 시 자동 채워짐)

[CONTEXT BRIDGE]
핵심제약: (harness-executor가 자동 추출)
TDD도메인: (없음)
절대금지: (없음)
실패롤백: (없음)

---

## NOW

## NEXT

## DONE

## BLOCKED

## BACKLOG
"

# GSD_LOG.md
write_file ".claude/harness/GSD_LOG.md" "# GSD_LOG.md — 실행 이력
# 형식: [YYYY-MM-DD HH:MM] 아이콘 | 태스크명 | 파일 | 소요 | 결과

"

# ROLLBACK_LOG.md
write_file ".claude/harness/ROLLBACK_LOG.md" "# ROLLBACK_LOG.md — 반려·롤백 이력
# 형식: [YYYY-MM-DD] | 유형 | 오류 내용 | 조치

"

# core-rules.md (스택별 분기)
if [[ "$STACK" == "sveltekit" ]]; then
  STACK_RULES="SvelteKit 5 (Svelte 5 Runes)
- 상태: \$state() / \$derived() / \$effect()  — writable store 사용 금지
- 이벤트: onclick={handler}  — on:click 금지 (Svelte 4 문법)
- Props: interface Props {} + let { ... }: Props = \$props()"
elif [[ "$STACK" == "nextjs" ]]; then
  STACK_RULES="Next.js 15 App Router
- Server Components 기본 사용 (use client 최소화)
- 데이터 페칭: React Server Components + fetch
- 상태: useState / Zustand (서버 상태 × )"
else
  STACK_RULES="[스택별 규칙을 직접 작성하세요]"
fi

write_file ".claude/rules/core-rules.md" "# core-rules.md — 개발 실행 원칙
# Harness Flow v3.2 | ${PROJECT_NAME}

---

## 스택 규칙

\`\`\`
${STACK_RULES}

TypeScript
- any 타입 절대 금지
- 반환 타입 명시 필수
\`\`\`

---

## 파일 경로 규칙

\`\`\`
[프로젝트에 맞게 수정하세요]
서버 전용 로직    : src/routes/**/+page.server.ts
도메인 서비스     : src/lib/services/{module}.ts
UI 컴포넌트      : src/lib/components/{category}/{Name}.svelte
타입 정의        : src/lib/types/{domain}.ts
테스트           : src/__tests__/{module}.test.ts
\`\`\`

---

## 코드 품질 기준

\`\`\`
console.log  : 금지 (GATE C 전 전수 제거)
TODO/FIXME   : TASK.md BACKLOG 등록 후 코드에서 제거
에러 핸들링  : 빈 catch 금지
N+1 쿼리     : 금지
\`\`\`

---

*core-rules.md v3.2 | Harness Flow | ${PROJECT_NAME}*
"

write_file ".claude/rules/security-compliance.md" "# security-compliance.md — 보안 규칙
# Harness Flow v3.2 | ${PROJECT_NAME}

---

## 자격증명 원칙

\`\`\`
- .env 파일은 src/ 경로로 복사 금지
- 하드코딩된 API Key, Secret 커밋 금지
- 서버 전용 키는 서버사이드 환경변수에서만 참조
\`\`\`

---

## 인증/인가

\`\`\`
- JWT는 서버사이드에서만 검증
- 클라이언트 role 값으로만 UI 숨기는 것은 허용 (데이터 접근은 서버에서 재검증)
\`\`\`

---

## 입력값 검증

\`\`\`
- 모든 외부 입력(form, query param)은 서버에서 재검증
- SQL 파라미터 바인딩 사용 (문자열 직접 연결 금지)
\`\`\`

---

*security-compliance.md v3.2 | Harness Flow | ${PROJECT_NAME}*
"

# .gitignore 업데이트
if [[ "$DRY_RUN" == "false" ]]; then
  GITIGNORE_ENTRIES=(
    ""
    "# Harness Flow — auto-generated (do not commit)"
    ".claude/harness/telemetry/"
    ".claude/harness/learnings/compile_error.md"
    ".claude/harness/learnings/last_error.md"
    ".claude/harness/HANDOFF.md"
  )
  for entry in "${GITIGNORE_ENTRIES[@]}"; do
    if [[ -n "$entry" ]]; then
      grep -qF "$entry" .gitignore 2>/dev/null || echo "$entry" >> .gitignore
    fi
  done
  echo -e "  ${GREEN}✔ .gitignore 업데이트 완료${RESET}"
fi

# ── 완료 요약 ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║  ✅ Harness Flow v3.2 초기화 완료!               ║${RESET}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════╣${RESET}"
echo -e "${GREEN}${BOLD}║  다음 단계:                                      ║${RESET}"
echo -e "${GREEN}${BOLD}║  1. CLAUDE.md → 프로젝트 정보 수정               ║${RESET}"
echo -e "${GREEN}${BOLD}║  2. AGENTS.md → 스택 정보 + 도메인 규칙 추가    ║${RESET}"
echo -e "${GREEN}${BOLD}║  3. .claude/rules/*.md → 실무 규칙 작성          ║${RESET}"
echo -e "${GREEN}${BOLD}║  4. TDD 강제 키워드 도메인 정의                  ║${RESET}"
echo -e "${GREEN}${BOLD}║  5. (선택) GitHub Actions CI 파이프라인 활성화   ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${CYAN}시작 명령:${RESET} B-START: [첫 번째 태스크]"
echo ""
