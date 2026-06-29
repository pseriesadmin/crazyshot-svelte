# CURSOR_START.md — Cursor 하네스 세션 시작 템플릿
# Harness Flow v3.2 | SSOT: .claude/harness/
# 상태 파일 정본은 .claude/harness/ — 이 폴더는 템플릿 전용

---

## ╔══ [A] 이어서 하기 — 세션 재시작 프롬프트 ══╗

> 커서 채팅 창에 아래 텍스트를 그대로 복붙하세요.

---

```
크레이지샷 하네스 세션을 이어서 시작합니다.

먼저 아래 파일들을 읽어주세요:
@AGENTS.md
@CLAUDE.md
@.claude/harness/TASK.md
@.claude/harness/GSD_LOG.md
@.claude/harness/context-hook.md
@.claude/harness/HANDOFF.md
@.claude/harness/AI_COLLAB_PROTOCOL.md
@.claude/harness/learnings/misidentifications.md

읽은 후 HOOK-4 재시작 브리핑을 실행해주세요:
- 현재 아젠다 1줄 요약
- DONE 완료된 태스크 수
- 현재 NOW 태스크명
- BLOCKED 항목 존재 여부
- 마지막 수정 파일 (GSD_LOG 기준)

브리핑이 끝나면 "계속할까요?" 한 줄로 물어보고 대기해주세요.
Stephen이 "응" 또는 "계속"을 입력하면 현재 NOW 태스크부터 시작합니다.

GATE 등급 원칙:
🔴 CRITICAL → 반드시 멈추고 Stephen 확인 (결제·예약·보안·DB 다중변경)
🟡 BOUNDARY → 자동 진행 + 완료 1줄 보고 (확인 요청 불필요)
🟢 ROUTINE  → 자동 진행 + 결과 보고만

절대 금지:
- git 명령어 자율 실행
- Supabase RPC 없이 직접 INSERT
- Svelte 4 문법 (on:event → onevent, writable → $state)
- 서버 키를 $env/static/public에 import
- frozen 파일 수정 (아래 frozen 목록 참조)

⚠️ frozen 파일 수정 요청이 오면:
→ 작업 중단 + "이 파일은 Claude Code 전용 영역입니다. Stephen에게 Claude 세션 전환을 요청해주세요." 안내
```

---

## ╔══ [B] 새 작업 시작 — B-START 프롬프트 ══╗

> {아젠다 내용을 여기에 작성} 부분만 바꿔서 붙여넣으세요.

---

```
[B-START] 크레이지샷 새 작업을 시작합니다.

먼저 아래 파일들을 읽어주세요:
@AGENTS.md
@CLAUDE.md
@.claude/harness/TASK.md
@.claude/harness/GSD_LOG.md
@.claude/harness/AI_COLLAB_PROTOCOL.md

━━━ 아젠다 ━━━
{아젠다 내용을 여기에 작성}
━━━━━━━━━━━━━

위 아젠다를 받았으면 다음 순서로 처리해주세요:

1. AGENTS.md 황금 원칙 + TDD 강제 키워드 확인
2. TDD 도메인인지 GSD 도메인인지 판별
   - TDD 키워드: 결제/환불/예약/가용성/이중예약/보증금/atomic_reserve/크레이지스코어/RLS/인증
   - 그 외: GSD
3. 아젠다에서 완료조건·금지조건·실패롤백 3항목 추출
4. NOW 태스크 목록 작성 (15~30분 단위)
5. GATE B 판별:
   - CRITICAL(결제·예약·보안·DB변경) → GATE B 포맷 출력 후 Stephen 승인 대기
   - GSD·ROUTINE(UI/스타일/컴포넌트/단일기능) → "⚡ GATE B 자동 통과" 후 즉시 실행

GATE B 포맷 (CRITICAL 시):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 GATE B — 이 작업을 진행해도 될까요?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
이번 작업: {서비스 기능 언어 1~2줄}
진행 순서:
  1. {태스크명} — {서비스 역할} [CRITICAL/BOUNDARY/ROUTINE]
  2. ...
AI 사전 검증: ✓ 도메인 정합 ✓ 보안 ✓ 의존성 ✓ frozen 경계 확인
→ "맞아" / "아니야: [다른 점]"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GATE 등급:
🔴 CRITICAL → 멈추고 Stephen 확인 필수
🟡 BOUNDARY → 자동 진행 + 완료 1줄 보고
🟢 ROUTINE  → 자동 진행 + 결과 보고

절대 금지: git 자율 실행 / 직접 INSERT / Svelte 4 문법 / 서버 키 클라이언트 노출 / frozen 파일 수정
```

---

## ╔══ [C] Cursor 완료 후 TASK.md 기록 규칙 ══╗

UI 작업 완료 시 `.claude/harness/TASK.md`에 기록:

```
허용:
  ✅ DONE 섹션에 완료 항목 1줄 추가
  ✅ NOW 체크박스 [ ] → [x] 변경
  ✅ GSD_LOG.md에 완료 1줄 동시 기록

금지:
  ❌ 섹션 추가·삭제·재정렬
  ❌ CONTEXT BRIDGE 수정
  ❌ 기존 항목 편집 또는 삭제
  ❌ 파일 전체 재생성
```

HANDOFF.md도 갱신 — 2번(건드린 파일) + 5번(다음 단계):
```
@.claude/harness/HANDOFF.md
```

---

## @멘션으로 읽을 수 있는 핵심 파일 목록

```
── 황금 원칙 ──
@AGENTS.md                                       ← 황금 원칙 + TDD 강제 키워드
@CLAUDE.md                                       ← 세션 시작 가이드

── 하네스 상태 (.claude/harness/ — SSOT 정본) ──
@.claude/harness/TASK.md                         ← NOW/DONE/BLOCKED ★
@.claude/harness/GSD_LOG.md                      ← 작업 이력
@.claude/harness/HANDOFF.md                      ← AI 전환 인수인계 ★
@.claude/harness/AI_COLLAB_PROTOCOL.md           ← 혼성 AI 협업 헌장
@.claude/harness/context-hook.md                 ← HOOK-1~8
@.claude/harness/SUPABASE_DB.md                  ← Supabase DB 2개 정의
@.claude/harness/ERROR_TAXONOMY.md               ← 에러 분류
@.claude/harness/HANDOFF_TEMPLATE.md             ← 핸드오프 양식
@.claude/harness/ARCHITECTURE.md                 ← 5계층 + 3-Tier 구조
@.claude/harness/middleware-guards.md            ← 7가지 보안 가드
@.claude/harness/ROLLBACK_LOG.md                 ← 롤백 이력
@.claude/harness/learnings/misidentifications.md ← 오인 카탈로그 ★

── Cursor 전용 (이 폴더) ──
@.cursor/harness/boundary-rules.yaml             ← H-01~H-07 자동 검사
@.cursor/harness/CURSOR_START.md                 ← 이 파일

── 에이전트 ──
@.cursor/agents/harness-executor.md              ← GATE B/C 처리 상세 규칙
@.cursor/agents/promptor.md                      ← 대형 아젠다 분석
@.cursor/agents/sp2-tdd-agents.md               ← TDD Worker
@.cursor/agents/qa.md                            ← GATE E 검수 기준
@.cursor/agents/sp4-deploy-agent.md              ← 배포 체크리스트

── 도메인 규칙 ──
@.cursor/rules/harness-rules.mdc                 ← 스택·보안·RLS (공통)
@.cursor/rules/uiux.mdc                          ← UI/UX 디자인 시스템
@.cursor/rules/domain-ui-mobile.mdc              ← Svelte 5 Runes + 모바일
@.cursor/rules/domain-rental.mdc                 ← 예약·가용성 도메인
@.cursor/rules/domain-payment.mdc                ← 결제·웹훅 도메인
@.cursor/rules/domain-frozen-boundary.mdc        ← frozen 파일 보호 규칙
```

---

## 자주 쓰는 단어 명령

```
"컨텍스트 체크"  → HOOK-4: 현재 상태 재브리핑
"파일 확인해"    → HOOK-1: 추측 없이 실제 파일 Read
"핸드오프"       → HOOK-6: .claude/harness/HANDOFF.md 갱신
"스킵"           → HOOK-8: BLOCKED 항목 BACKLOG 이동 + 다음 NOW
"스벨트 확인"    → HOOK-5: Svelte 5 Runes 패턴 체크
"에러 분류"      → ERROR_TAXONOMY.md Class 판별
"오인 기록"      → HOOK-7: .claude/harness/learnings/misidentifications.md 기록
"Claude로 복귀"  → HANDOFF.md 갱신 후 Stephen에게 전환 안내
```

---

*CURSOR_START.md | Harness Flow v3.2 | SSOT: .claude/harness/*
*이 폴더(.cursor/harness/)는 세션 시작 템플릿 + boundary-rules.yaml 전용*
*복붙 후 {중괄호} 부분만 수정해서 사용*
