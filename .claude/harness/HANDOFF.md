# HANDOFF.md — AI 세션 인수인계
# Harness Flow v3.2 | Claude Code ↔ Cursor AI 전환 시 필수 갱신
# 형식: AI_COLLAB_PROTOCOL.md 원칙 C 기준

---

## 현재 상태 (2026-06-28 초기화)

### 1. 의도
혼성 AI 협업 정합 작업 — SSOT를 `.claude/harness/`로 통일하고
Cursor가 frozen 파일을 건드리지 않도록 경계 문서·규칙 완비.

### 2. 건드린 파일
```
.claude/harness/AI_COLLAB_PROTOCOL.md   [신규]
.claude/harness/HANDOFF.md              [신규 — 이 파일]
.cursor/harness/CURSOR_START.md         [SSOT 경로 교체]
.cursor/harness/README.md               [신규]
.cursor/rules/crazyshot-system.mdc      [SSOT 경로 교체]
.claude/harness/PORTABILITY.md          [crazyshot 예외 절 추가]
```

### 3. 금지
```
- src/lib/services/supabase.ts 수정 금지 (baseline: fed4fdb)
- src/hooks.server.ts 수정 금지
- src/routes/api/** 수정 금지
- supabase/migrations/** 신규 ADD 외 수정 금지
- $env import 파일 수정 금지
- .claude/harness/ 구조·섹션 임의 변경 금지
```

### 4. 오인 주의
```
최근 오인: 2026-06-27 — supabase.ts createBrowserClient를
createClient 싱글톤으로 "통일"했다가 채팅 401 발생.
→ 참조: .claude/harness/learnings/misidentifications.md
```

### 5. 다음 한 단계
```
TASK.md NOW: T9 AdminChatPanel + admin 레이아웃
상태: BLOCKED (관리자 전용 레이아웃 미구축 — 별도 일정 확정 후)
→ 다음 실행 가능 태스크: S1-M3 Payment Integration (TDD)
```

---

## 사용법

**Claude → Cursor 전환 시:**
1. Claude가 이 파일 5필드 갱신
2. Stephen이 Cursor 세션에 `@.claude/harness/HANDOFF.md` 붙여넣기
3. Cursor가 읽고 범위 내 작업만 진행

**Cursor → Claude 복귀 시:**
1. Cursor가 이 파일 2번(건드린 파일) + 5번(다음 단계) 갱신
2. Stephen이 Claude Code 세션에 `@.claude/harness/HANDOFF.md 읽고 diff 검토` 요청
3. Claude가 frozen file 변경 여부 확인 → 이상 없으면 진행

---

*HANDOFF.md | AI_COLLAB_PROTOCOL.md 원칙 C | 세션 전환마다 갱신*
