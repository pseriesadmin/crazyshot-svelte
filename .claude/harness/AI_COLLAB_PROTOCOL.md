# AI_COLLAB_PROTOCOL.md — 혼성 AI 협업 헌장
# Harness Flow v3.2 | Claude Code + Cursor AI 공동 운영 기준
# 최초 작성: 2026-06-28 | 사고 기록: 89e427b → fed4fdb

> 이 문서는 Claude Code와 Cursor AI가 동일 저장소에서 협업할 때
> 지켜야 할 원칙·경계·핸드오프·게이트를 정의한다.
> **위반 시 즉시 중단 + Stephen 확인.**

---

## 원칙 A — 역할 고정

| AI | 담당 영역 | 금지 영역 |
|----|----------|----------|
| **Claude Code** | 아키텍처·TDD·DB·API·env·인증·서비스 레이어 | — |
| **Cursor** | `*.svelte` UI/스타일 ROUTINE 퍼블리싱 | frozen 파일 (아래 목록) |

Cursor가 frozen 파일 수정 요청을 받으면:
→ **작업 중단** + Stephen에게 "Claude 세션으로 전환해주세요" 안내

---

## 원칙 B — SSOT (단일 진실 소스)

```
정본: .claude/harness/
  TASK.md          ← 현재 NOW/DONE/BLOCKED
  GSD_LOG.md       ← 작업 이력·마지막 수정 파일
  HANDOFF.md       ← AI 전환 시 인수인계 문서
  ROLLBACK_LOG.md  ← 롤백·반려 이력
  learnings/       ← 오인 카탈로그·학습 기록

규칙:
  - Claude Code: 모든 상태를 .claude/harness/에 기록
  - Cursor: 세션 시작 시 .claude/harness/ 파일만 읽음
  - .cursor/harness/에는 CURSOR_START.md + boundary-rules.yaml만 유지
```

### Cursor의 TASK.md 기록 규칙 (형식 오염 방지)

```
✅ 허용:
  - DONE 섹션에 완료 항목 1줄 추가
  - NOW 체크박스 상태 변경 [ ] → [x]
  - GSD_LOG.md에 완료 1줄 동시 기록

❌ 금지:
  - 섹션 추가·삭제·재정렬
  - CONTEXT BRIDGE 수정
  - 기존 DONE 항목 편집
  - TASK.md 전체 재생성
```

---

## 원칙 C — 핸드오프 (AI 전환 시 필수)

전환마다 `.claude/harness/HANDOFF.md` 5필드 필수 갱신:

```
1. 의도    — 이번 세션 서비스 목표 (Stephen 언어)
2. 파일    — 건드린 파일 경로 목록
3. 금지    — frozen files + "supabase/API/env 변경 금지"
4. 오인    — misidentifications.md 최근 1건 링크
5. 다음    — TASK.md NOW 1개만
```

**전환 트리거 (Stephen 단어 명령):**

| 명령 | 담당 AI |
|------|---------|
| `"Cursor로 UI"` | Cursor — HANDOFF 읽고 시작 |
| `"Claude로 복귀"` | Claude Code — HANDOFF diff 검토 후 진행 |
| `"핸드오프"` | HOOK-6 실행 (context-hook.md SIGNAL-1~2) |

**Claude 복귀 시 첫 동작:**
```
@.claude/harness/HANDOFF.md 읽고 Cursor 작업 diff 검토.
frozen file 변경 있으면 baseline(fed4fdb) 대비 diff 보고 후 GATE C.
```

---

## 원칙 D — 원자 커밋

```
1 NOW 태스크 = 1 커밋
- import·파일 쌍은 반드시 동시 스테이징
- 반쪽 커밋 금지 (200d50b 재발 방지)
```

---

## 원칙 E — 롤백 기준선 (Baseline)

```
supabase/auth 패턴 기준 커밋: fed4fdb

정본 패턴 (src/lib/services/supabase.ts):
  export const supabase = browser
    ? createBrowserClient<Database>(...)      // 브라우저: 쿠키 세션 공유
    : createClient<Database>(..., { auth: { persistSession: false } })

이 패턴을 변경하려면 반드시 Claude Code 세션 + GATE C 필수.
```

---

## 원칙 F — GATE 언어

```
Stephen에게 노출하는 GATE 질문:
  ✅ 서비스 의도 언어 (기능·사용자 행동·비즈니스 정책)
  ❌ 기술 용어 (createBrowserClient, RLS, JWT, SSR 등)
```

---

## Frozen 파일 목록 (Cursor 접근 금지)

```
src/lib/services/supabase.ts     ← baseline: fed4fdb 패턴 유지
src/hooks.server.ts
src/lib/env/supabasePublic.ts
src/lib/stores/auth.ts
src/routes/api/**/*
supabase/migrations/**           ← 신규 ADD만 허용 (GP-10)
$env import가 있는 모든 파일
```

변경이 필요한 경우:
→ Stephen에게 "Claude 세션 전환" 요청 → GATE C → Claude 검토 완료 후 커밋

---

## 사고 기록 (학습 자산)

| 날짜 | 사건 | 원인 | 조치 |
|------|------|------|------|
| 2026-06-27 | `89e427b` Cursor가 supabase.ts createBrowserClient → createClient 교체 → 채팅 401 | SSOT 이중화, frozen 경계 미설정 | `fed4fdb` 원복 |
| 2026-06-26 | 미커밋 chat import → Vercel 빌드 실패 | 원자 커밋 미준수 | `200d50b` |
| 2026-06-27 | PUBLIC_/VITE_ env 불일치 | env 경계 미준수 | `557e010` |

---

## Stephen 커밋 전 체크리스트

```
[ ] git status clean 또는 WIP 브랜치명 명시
[ ] 1 NOW = 1 커밋 (import/파일 쌍 동시 스테이징)
[ ] npm run harness:check 통과 (eslint + tsc 전체)
[ ] frozen file diff 있으면 Claude 검토 완료
[ ] ROLLBACK_LOG 또는 GSD_LOG 1줄 기록 (fix 커밋 시)
```

## Stage 배포 정책

```
기본:          Claude 세션 종료 + harness:check + Stephen 커밋 후 stage
Cursor만 작업: frozen 미변경 + ROUTINE UI + harness:check → stage 허용
CRITICAL 도메인(결제·예약·auth): Claude 세션 필수
```

---

*AI_COLLAB_PROTOCOL.md | Harness Flow v3.2 | 혼성 AI 협업 헌장*
*원칙 A~F + 사고 기록 + 커밋 게이트 통합*
*참조: .claude/harness/TASK.md · HANDOFF.md · ROLLBACK_LOG.md · learnings/misidentifications.md*
