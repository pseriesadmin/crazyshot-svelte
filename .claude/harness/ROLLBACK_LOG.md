# ROLLBACK_LOG.md — 크레이지샷 반려·롤백 이력
# 형식: [YYYY-MM-DD HH:MM] | 사유 | 오류 내용 | 조치

---

## 소급 기록 (2026-06-26~28 사고 3건)

| 날짜 | 커밋 | 사유 | 증상 | baseline | 조치 커밋 |
|------|------|------|------|----------|----------|
| 2026-06-27 | `89e427b` | Cursor AI가 supabase.ts `createBrowserClient` → `createClient` 싱글톤으로 교체 | 채팅 세션 401 Unauthorized (쿠키 기반 세션 공유 끊김) | `9152789` (createBrowserClient 패턴) | `fed4fdb` 원복 |
| 2026-06-26 | — | 미커밋 상태의 chat import가 Vercel 빌드에 포함됨 | Vercel 빌드 실패 (모듈 경로 미존재) | — | `200d50b` |
| 2026-06-27 | — | PUBLIC_SUPABASE_URL 대신 VITE_ 접두사 env 불일치 | API 라우트 Supabase 연결 실패 | — | `557e010` |

### 사고 공통 원인

```
1. Cursor AI가 .cursor/harness/TASK.md(비동기화 상태)를 SSOT로 읽음
2. frozen file 경계 미설정 → 서비스 레이어 수정 허용됨
3. 핸드오프 프로토콜 미실행 → Claude Code 설계 맥락 전달 안 됨
4. 부분 커밋(미완성 import 포함) → 빌드 실패
```

### 재발 방지 조치 (2026-06-28 적용)

```
- .claude/harness/AI_COLLAB_PROTOCOL.md 생성 (frozen 경계 명시)
- .cursor/rules/domain-frozen-boundary.mdc 생성 (Cursor 접근 차단)
- .claude/harness/SSOT 통합 (Cursor가 .cursor/harness/* 읽지 않도록)
- CURSOR_START.md에 TASK.md 기록 규칙 명시 (형식 오염 방지)
```

---

