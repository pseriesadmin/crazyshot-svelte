#!/bin/bash
# harness-health-check.sh — Harness Flow v3.2
# 주기적 점검: Harness 전체 상태 진단
# 사용법: bash scripts/harness-health-check.sh [--fix]

set -euo pipefail

FIX_MODE=false
[[ "${1:-}" == "--fix" ]] && FIX_MODE=true

HARNESS_DIR=".claude/harness"
LEARNINGS_DIR="$HARNESS_DIR/learnings"
TASK_FILE="$HARNESS_DIR/TASK.md"
AGENTS_DIR=".claude/agents"
RULES_DIR=".claude/rules"

C_RESET='\033[0m'
C_RED='\033[0;31m'
C_YELLOW='\033[1;33m'
C_GREEN='\033[0;32m'
C_CYAN='\033[0;36m'
C_GRAY='\033[0;37m'

err=0
warn=0

echo ""
echo -e "${C_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "🏥  Harness Health Check v3.2"
echo -e "    $(date '+%Y-%m-%d %H:%M')"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo ""

# ── 1. 필수 파일 존재 확인 ────────────────────────────────────────────
echo -e "${C_GRAY}[1/7] 필수 파일 존재 확인...${C_RESET}"

REQUIRED_FILES=(
  "AGENTS.md"
  "CLAUDE.md"
  "$HARNESS_DIR/TASK.md"
  "$HARNESS_DIR/boundary-rules.yaml"
  "$HARNESS_DIR/ARCHITECTURE.md"
  "$HARNESS_DIR/middleware-guards.md"
  "$HARNESS_DIR/mcp-servers.json"
  "$AGENTS_DIR/harness-executor.md"
  "$AGENTS_DIR/shared/sp2-tdd-agents.md"
  "$AGENTS_DIR/shared/sp3-qa-agent.md"
  "$AGENTS_DIR/shared/sp4-deploy-agent.md"
  "$RULES_DIR/core-rules.md"
  "$RULES_DIR/rental.md"
  "$RULES_DIR/payment.md"
  "$RULES_DIR/ui-mobile.md"
  "$RULES_DIR/security-auth.md"
  ".husky/pre-commit"
)

all_ok=true
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo -e "  ${C_RED}✗ 누락: $f${C_RESET}"
    all_ok=false
    ((err++)) || true
  fi
done
$all_ok && echo -e "  ${C_GREEN}✓ 필수 파일 전체 존재${C_RESET}"

# ── 2. TASK.md 상태 점검 ──────────────────────────────────────────────
echo -e "${C_GRAY}[2/7] TASK.md 상태...${C_RESET}"

if [ -f "$TASK_FILE" ]; then
  NOW_COUNT=$(grep -c "^- \[ \]" "$TASK_FILE" 2>/dev/null | tr -d ' ' || echo 0)
  DONE_COUNT=$(grep -c "^- \[x\]" "$TASK_FILE" 2>/dev/null | tr -d ' ' || echo 0)
  BLOCKED_COUNT=$(grep -c "BLOCKED" "$TASK_FILE" 2>/dev/null | tr -d ' ' || echo 0)
  # 숫자 보정 (grep -c가 "0\n" 형태로 반환 시)
  NOW_COUNT=$(echo "$NOW_COUNT" | head -1 | tr -d '[:space:]')
  DONE_COUNT=$(echo "$DONE_COUNT" | head -1 | tr -d '[:space:]')
  BLOCKED_COUNT=$(echo "$BLOCKED_COUNT" | head -1 | tr -d '[:space:]')
  : "${NOW_COUNT:=0}" "${DONE_COUNT:=0}" "${BLOCKED_COUNT:=0}"

  # 마지막 수정 나이 (macOS stat)
  TASK_MTIME=$(stat -f %m "$TASK_FILE" 2>/dev/null || date +%s)
  NOW_TS=$(date +%s)
  AGE_DAYS=$(( (NOW_TS - TASK_MTIME) / 86400 ))

  echo "  NOW:     $NOW_COUNT개"
  echo "  DONE:    $DONE_COUNT개"
  echo "  BLOCKED: $BLOCKED_COUNT개"

  if [ "$AGE_DAYS" -gt 7 ]; then
    echo -e "  ${C_YELLOW}⚠ TASK.md ${AGE_DAYS}일 미수정 — 현황 업데이트 권장${C_RESET}"
    ((warn++)) || true
  else
    echo -e "  ${C_GREEN}✓ 최근 수정: ${AGE_DAYS}일 전${C_RESET}"
  fi

  if [ "$NOW_COUNT" -gt 15 ]; then
    echo -e "  ${C_YELLOW}⚠ NOW 태스크 ${NOW_COUNT}개 과다 — 분해·정리 권장${C_RESET}"
    ((warn++)) || true
  fi
fi

# ── 3. Learnings 디렉터리 점검 ────────────────────────────────────────
echo -e "${C_GRAY}[3/7] Learnings 디렉터리...${C_RESET}"

if [ -d "$LEARNINGS_DIR" ]; then
  L_COUNT=$(find "$LEARNINGS_DIR" -name "*.md" ! -name ".gitkeep" | wc -l | tr -d ' ')
  L_SIZE=$(du -sh "$LEARNINGS_DIR" 2>/dev/null | cut -f1)

  echo "  파일: ${L_COUNT}개 / 크기: ${L_SIZE}"

  if [ "$L_COUNT" -gt 20 ]; then
    echo -e "  ${C_YELLOW}⚠ Learnings 파일 ${L_COUNT}개 — 오래된 파일 정리 고려${C_RESET}"
    ((warn++)) || true
  else
    echo -e "  ${C_GREEN}✓ 적정 수준${C_RESET}"
  fi

  # 최근 에러 파일 나열
  RECENT=$(find "$LEARNINGS_DIR" -name "*.md" -newer "$TASK_FILE" 2>/dev/null | head -3)
  if [ -n "$RECENT" ]; then
    echo -e "  ${C_YELLOW}최근 에러 기록:${C_RESET}"
    echo "$RECENT" | while read -r f; do echo "    → $f"; done
  fi
else
  echo -e "  ${C_YELLOW}⚠ Learnings 디렉터리 없음 — mkdir 실행 권장${C_RESET}"
  if $FIX_MODE; then
    mkdir -p "$LEARNINGS_DIR"
    touch "$LEARNINGS_DIR/.gitkeep"
    echo -e "  ${C_GREEN}✓ 자동 생성됨${C_RESET}"
  fi
  ((warn++)) || true
fi

# ── 4. Boundary Violations 점검 ───────────────────────────────────────
echo -e "${C_GRAY}[4/7] 경계 위반 기록...${C_RESET}"

VIOLATIONS_FILE="$LEARNINGS_DIR/boundary_violations.md"
if [ -f "$VIOLATIONS_FILE" ]; then
  V_MTIME=$(stat -f %m "$VIOLATIONS_FILE" 2>/dev/null || date +%s)
  V_AGE=$(( ($(date +%s) - V_MTIME) / 3600 ))
  ERROR_COUNT=$(grep -c "^### " "$VIOLATIONS_FILE" 2>/dev/null || echo 0)

  if [ "$ERROR_COUNT" -gt 0 ]; then
    echo -e "  ${C_RED}⚠ 미해결 경계 위반 ${ERROR_COUNT}건 (${V_AGE}시간 전)${C_RESET}"
    echo -e "  ${C_GRAY}→ $VIOLATIONS_FILE 확인${C_RESET}"
    ((err++)) || true
  else
    echo -e "  ${C_GREEN}✓ 활성 경계 위반 없음${C_RESET}"
  fi
else
  echo -e "  ${C_GREEN}✓ 위반 기록 없음${C_RESET}"
fi

# ── 5. TypeScript + 린트 빠른 점검 ───────────────────────────────────
echo -e "${C_GRAY}[5/7] 타입스크립트 / 린트...${C_RESET}"

if command -v npx &> /dev/null; then
  # tsc 빠른 검사
  TSC_OUT=$(npx tsc --noEmit 2>&1 | head -5)
  if [ -n "$TSC_OUT" ]; then
    echo -e "  ${C_YELLOW}⚠ TypeScript 경고 있음:${C_RESET}"
    echo "$TSC_OUT" | while read -r l; do echo "    $l"; done
    ((warn++)) || true
  else
    echo -e "  ${C_GREEN}✓ TypeScript 에러 없음${C_RESET}"
  fi
else
  echo -e "  ${C_GRAY}  npx 미설치 — 생략${C_RESET}"
fi

# ── 6. Svelte 4 문법 잔류 검사 ────────────────────────────────────────
echo -e "${C_GRAY}[6/7] Svelte 4 문법 잔류...${C_RESET}"

SV4_COUNT=$(grep -rn "on:click\|on:input\|on:submit\|on:change\|on:keydown" \
  src/ --include="*.svelte" 2>/dev/null | grep -cv "harness-allow" || echo 0)
SV4_COUNT=$(echo "$SV4_COUNT" | tr -d ' ')
STORE_COUNT=$(grep -rn "from 'svelte/store'\|writable(" \
  src/lib/components/ --include="*.svelte" --include="*.ts" 2>/dev/null | \
  grep -cv "harness-allow" || echo 0)
STORE_COUNT=$(echo "$STORE_COUNT" | head -1 | tr -d '[:space:]')

if [ "$SV4_COUNT" -gt 0 ]; then
  echo -e "  ${C_RED}✗ Svelte 4 이벤트 문법 ${SV4_COUNT}건 잔류${C_RESET}"
  ((err++)) || true
else
  echo -e "  ${C_GREEN}✓ Svelte 4 이벤트 문법 없음${C_RESET}"
fi

if [ "$STORE_COUNT" -gt 0 ]; then
  echo -e "  ${C_YELLOW}⚠ writable store ${STORE_COUNT}건 (→ \$state() 마이그레이션 권장)${C_RESET}"
  ((warn++)) || true
else
  echo -e "  ${C_GREEN}✓ writable store 없음${C_RESET}"
fi

# ── 7. 에이전트 파일 최신성 ───────────────────────────────────────────
echo -e "${C_GRAY}[7/7] 에이전트 파일 버전...${C_RESET}"

EXECUTOR_VER=$(grep "v3\." "$AGENTS_DIR/harness-executor.md" 2>/dev/null | head -1 | grep -o "v3\.[0-9]*" | head -1)
SP2_VER=$(grep "v3\." "$AGENTS_DIR/shared/sp2-tdd-agents.md" 2>/dev/null | head -1 | grep -o "v3\.[0-9]*" | head -1)

echo "  harness-executor: ${EXECUTOR_VER:-unknown}"
echo "  sp2-tdd-agents:   ${SP2_VER:-unknown}"

if [[ "$EXECUTOR_VER" == "v3.2" ]] && [[ "$SP2_VER" == "v3.2" || "$SP2_VER" == "v3.0" ]]; then
  echo -e "  ${C_GREEN}✓ 에이전트 버전 최신${C_RESET}"
else
  echo -e "  ${C_YELLOW}⚠ 에이전트 버전 확인 필요${C_RESET}"
  ((warn++)) || true
fi

# ── 최종 리포트 ──────────────────────────────────────────────────────
echo ""
echo -e "${C_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"

if [ "$err" -gt 0 ]; then
  echo -e "${C_RED}🔴 결과: ERROR ${err}건 / WARNING ${warn}건"
  echo -e "   즉각 조치 필요${C_RESET}"
  exit_code=1
elif [ "$warn" -gt 0 ]; then
  echo -e "${C_YELLOW}🟡 결과: WARNING ${warn}건"
  echo -e "   GATE C 전 확인 권장${C_RESET}"
  exit_code=0
else
  echo -e "${C_GREEN}🟢 결과: 전체 정상${C_RESET}"
  exit_code=0
fi

echo -e "${C_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo ""
exit $exit_code
