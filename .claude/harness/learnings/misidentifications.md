# misidentifications.md — 오인 카탈로그
# 자동 기록 (HOOK-7) | 세션 재시작 시 최근 5건 자동 로드
# 형식: | 날짜 | 도메인 | 오인 내용 | 올바른 해석 | 원인 | 횟수 |

| 날짜 | 도메인 | 오인 내용 | 올바른 해석 | 원인 | 횟수 |
|------|--------|-----------|-------------|------|------|
| 2026-06-27 | auth/supabase | `createClient` 싱글톤으로 "통일"하면 SSR·CSR 모두 작동할 것이라 판단 | 브라우저는 `createBrowserClient`로 서버 `safeGetSession` 쿠키 공유 필수. `createClient`는 세션 없이 anonymous로 동작 → 채팅 401 | Cursor 세션 독립 운영 중 HOOK-5·frozen file 미적용. 설계 맥락(쿠키 기반 세션 계약)이 Cursor에 전달되지 않음 | 1 |
