# CLAUDE.md — 크레이지샷 세션 시작 가이드
# Harness Flow v3.2 | 모든 세션에서 자동 로드

---

## 이 프로젝트는

```
크레이지샷 (crazyshot.kr) — 촬영장비 렌탈 플랫폼
스택: SvelteKit 5 + TypeScript · Supabase · Vercel · 토스페이먼츠 v2
목표: 시범서비스 오픈 (W1~W12)
워크플로우: Harness Flow v3.2 (반자동화 AI 에이전틱 개발)
```

---

## 세션 시작 시 반드시 확인

```
1. .claude/harness/TASK.md → 현재 NOW / DONE / BLOCKED 상태
2. .claude/harness/GSD_LOG.md → 마지막 완료 태스크와 수정 파일
3. AGENTS.md → 황금 원칙 + TDD 강제 키워드 + Error Taxonomy
4. .claude/harness/HANDOFF.md → 세션 이관 문서 (존재 시 최우선 확인)
5. .claude/harness/learnings/*.md → 이전 세션 학습 기록 (있을 경우)
```

> 새 채팅 시작 = context-hook.md HOOK-4 자동 실행

---

## 현재 진행 상태

```
✅ S0: 환경 설정 완료 (Supabase 스키마 30+ 테이블, RLS, 9 RPC)
✅ S1-M1: Products 모듈 완료
🔄 S1-M2: Reservation Flow (TDD RED/GREEN 완료, REFACTOR 진행중)
   ⚠️ BLOCKED: Supabase Realtime SSR WebSocket 이슈
⏳ S1-M3: Payment Integration (TDD) — 다음 사이클
⏳ S1-M4: Subscriptions (GSD)
⏳ S1-M5: Shipments (GSD)
```

---

## 에이전트 호출 규칙

```
[B-START] 입력 → @harness-executor (일반 아젠다)
대형 아젠다    → @promptor → TASK.md 생성 → @harness-executor
TDD 태스크     → @harness-executor가 @sp2-tdd-agents에 위임
모든 NOW 완료  → @sp3-qa-agent 자동 호출 (검수)
GATE E 통과    → @sp4-deploy-agent (배포 체크리스트)
세션 핸드오프  → "핸드오프" 입력 → HOOK-6 실행
오인 발생 시   → HOOK-7 자동 → misidentifications.md 기록
막힌 항목 스킵 → "스킵" 입력 → HOOK-8 실행
```

## GATE 등급 원칙 (기획 전문가·비개발자 Stephen 맞춤)

```
🔴 CRITICAL (핵심) → 서비스 의도 확인 필수
   결제·예약·보안·크레이지스코어 / 다중 파일·DB 변경 / GATE E

🟡 BOUNDARY (경계) → 자동 진행 + 완료 1줄 보고 (응답 불필요)
   단일 서비스 로직 / 신규 컴포넌트

🟢 ROUTINE (일반) → 자동 진행 + 결과 보고만
   UI 스타일·텍스트·기존 컴포넌트 수정

→ CRITICAL GATE 질문만 서비스 의도 언어로 (기술 용어 노출 금지)
→ GATE B 자동 통과: GSD/ROUTINE/UI퍼블리싱 단순 아젠다
```

---

## 에러 발생 시

```
Class A (네트워크/API) → 자동 재시도 (5회)
Class B (컴파일/테스트) → Self-Correction (3회) → .harness/learnings/ 저장
Class C (요구사항 불명확) → Stephen에게 에스컬레이션
Class D (보안 위반) → 즉시 중단

상세: .claude/harness/ERROR_TAXONOMY.md
```

---

## Supabase DB 환경 (혼용 절대 금지)

```
🔴 실서비스 DB  crazyshot (Production)
   Project ID : vnbpmvxruyciuuaermyh
   URL        : https://vnbpmvxruyciuuaermyh.supabase.co
   용도       : 실사용자 서비스 배포용 — 검증 완료 마이그레이션만 적용
   .env.local : ❌ 미연결 (Vercel 프로덕션 환경에서만 사용)

🟡 테스트 DB   crazyshot-stage (Stage)
   Project ID : ezyvffjvuwmtuhpxdjrw
   URL        : https://ezyvffjvuwmtuhpxdjrw.supabase.co
   용도       : 로컬 개발 기본값 + 마이그레이션 1차 검증
   .env.local : ✅ 현재 연결 중 (로컬 개발 서버)
   백업파일   : .env.local.stage-backup

⛔ 마이그레이션 필수 적용 순서 (위반 시 즉시 중단)
   1단계 → crazyshot-stage (ezyvffjvuwmtuhpxdjrw) 검증
   2단계 → crazyshot (vnbpmvxruyciuuaermyh) 실배포

⚠️ MCP apply_migration 실행 전 project_id 반드시 재확인
⚠️ 실서비스 DB에 미검증 마이그레이션 직접 적용 절대 금지
```

---

## 절대 기억할 것

```
❌ git 명령어 자율 실행 금지 (Stephen만)
❌ CRITICAL GATE 없이 다음 태스크 진행 금지 (BOUNDARY·ROUTINE은 자동)
❌ TDD 도메인에서 테스트 없이 구현 코드 작성 금지
❌ $env/static/public에 서버 키 import 금지
❌ 기존 마이그레이션 파일 직접 수정 금지
❌ Svelte 4 문법 사용 금지 (on:event → onevent)
❌ 하네스 플래닝에 Claude 네이티브 Plan 에이전트 사용 금지 → @promptor 또는 @harness-executor 사용
❌ Claude 네이티브 TaskCreate/TaskUpdate 도구 사용 금지 → .claude/harness/TASK.md 직접 편집
❌ 요청 범위 외 파일·코드 수정 금지 — 요청에 명시되지 않은 파일은 읽기만 허용, 수정 절대 금지
   → 범위 외 수정이 필요하다고 판단될 경우 반드시 Stephen에게 먼저 확인 후 진행
```

---

## 도메인 규칙 파일

```
.claude/rules/core-rules.md        ← 개발 실행 원칙 (스택, 파일 경로)
.claude/rules/rental.md            ← M2 예약·가용성 도메인
.claude/rules/payment.md           ← M3 결제·웹훅·PG 도메인
.claude/rules/ui-mobile.md         ← SvelteKit 5 UI + 모바일 UX + 터치 타겟
.claude/rules/uiux.md              ← 디자인 시스템 정본 (토큰·컴포넌트 패턴)
.claude/rules/cms-design.md        ← CMS 전용 디자인 시스템 (레이아웃·컴포넌트·GATE C)
.claude/rules/security-auth.md     ← 인증·RLS·보안
.claude/rules/figma-publishing.md  ← Figma AI 퍼블리싱 스킬 (디자인→코드 변환)
```

---

## 하네스 핵심 파일 (v3.2 신규)

```
.claude/harness/ERROR_TAXONOMY.md    ← 에러 분류 + 에스컬레이션 정책
.claude/harness/HANDOFF_TEMPLATE.md  ← 세션 전환 프로토콜
scripts/init-harness.sh              ← 다른 프로젝트 부트스트래핑
```

---

*CLAUDE.md | Harness Flow v3.2 | crazyshot 시범서비스 오픈*
