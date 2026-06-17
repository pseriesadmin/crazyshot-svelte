# ERROR_TAXONOMY.md — 에러 분류 체계 + 에스컬레이션 정책
# Harness Flow v3.2 | 엔터프라이즈 하네스 마스터 가이드 ch.13 구현체
# 참조: ARCHITECTURE.md LAYER 5 Control Loop

---

## 개요

에이전트가 "실패"하는 방식은 단일하지 않다.
에러 종류에 따라 대응 전략이 근본적으로 달라야 하며,
이 분류 체계 없이는 Self-Correction Loop가 무한 루프에 빠진다.

---

## 4대 에러 분류 (Error Taxonomy)

```
Error
 ├── Class A: Transient (일시적 — 자율 복구 가능)
 │   ├── API Rate Limit (429)
 │   ├── Network Timeout
 │   └── DB Connection Pool 고갈
 │
 ├── Class B: Deterministic (결정론적 — Self-Correction 대상)
 │   ├── TypeScript 컴파일 에러
 │   ├── ESLint 규칙 위반
 │   └── 단위 테스트 실패 (npm run test)
 │
 ├── Class C: Semantic (의미론적 — 인간 개입 필요)
 │   ├── Evaluator(sp3-qa-agent)가 3회 연속 REJECT
 │   ├── TASK.md 완료기준과 구현 결과 불일치
 │   └── B-START 아젠다 의도 모호성
 │
 └── Class D: Critical (치명적 — 즉시 세션 종료)
     ├── 프로덕션 DB에 직접 DDL 실행 시도
     ├── .env 파일 접근 또는 커밋 시도
     ├── 가드레일 파일(.claude/harness/, .husky/) 수정 시도
     └── TOSS_SECRET_KEY 등 서버 키 클라이언트 코드 삽입
```

---

## 에스컬레이션 정책 (각 Class별 대응)

### Class A: Transient — 자동 재시도

```
발생 → 즉시 중단 (작업 손실 방지)
    → Exponential Backoff 대기: 1s → 2s → 4s
    → 최대 5회 재시도
    → 5회 초과 → Class C로 에스컬레이션 (인프라 점검 필요)

에이전트 출력:
"⏳ [Class A] 일시적 오류. {delay}초 후 재시도 ({N}/5)..."
"↪ 원인: {error_message}"
```

**크레이지샷 적용 예시:**
```
Supabase RPC 타임아웃 → 1s → 2s → 4s 재시도
npm run check 일시적 프로세스 오류 → 재시도 1회
Vercel 함수 배포 중 네트워크 오류 → 재시도
```

---

### Class B: Deterministic — Self-Correction Loop

```
발생 → .harness/learnings/[domain]_error.md 자동 저장
    → 에러 메시지 파싱 (파일명 + 라인 + 원인)
    → 에이전트 자동 수정 시도 (최대 3회)
    → 3회 초과 → Class C로 에스컬레이션

에이전트 출력:
"🔄 [Class B] Self-Correction 시도 {N}/3"
"📍 위치: {파일경로}:{라인}"
"🔍 원인: {에러 타입} — {메시지}"
"🛠 수정: {어떤 변경을 할 것인가 1줄}"
```

**크레이지샷 적용 예시:**
```
TypeScript 컴파일 에러:
  "Type 'any' is not assignable to type 'string'"
  → 위치 확인 → 타입 명시로 수정 → npm run check 재실행

ESLint 위반:
  "no-console: Unexpected console statement"
  → console.log 제거 → npm run lint 재실행

테스트 실패:
  "expect(received).toBe(expected)"
  → 실패 테스트 파싱 → 구현 로직 수정 → npm run test 재실행
```

**Self-Correction 학습 파일 형식:**
```markdown
# [도메인]_error.md — YYYY-MM-DD HH:MM 자동 생성

## 에러 분류
Class: B (Deterministic)

## 에러 내용
```
{stderr 전문}
```

## 발생 위치
파일: {경로}
라인: {N}

## 수정 시도 이력
1회: {시도 내용} → {결과}
2회: {시도 내용} → {결과}
3회: {시도 내용} → {결과}

## 교훈 (다음 세션 참조)
- {재발 방지 원칙}
```

---

### Class C: Semantic — Stephen 에스컬레이션

```
발생 → 작업 즉시 중단
    → 현재 상태 요약 (무엇을 했고 무엇이 불분명한지)
    → Stephen에게 명확화 요청
    → Stephen 답변 후 재시작

에이전트 출력:
"🚨 [Class C] 의미론적 불일치. Stephen 개입 필요."
"📋 현재 상태: {한 것}"
"❓ 불분명한 점: {구체적으로 무엇이 모호한가}"
"📌 다음 단계: Stephen 답변 후 재시작 예정"
```

**크레이지샷 적용 예시:**
```
sp3-qa-agent가 "웹훅 처리 로직이 요구사항과 다르다"고 3회 REJECT
  → "B-START 아젠다의 웹훅 처리 의도를 재확인해야 합니다.
     - 현재 구현: raw_webhook_logs에 저장 후 즉시 200
     - QA 지적: pg_cron 트리거가 없어 백그라운드 처리가 안 됨
     - 질문: pg_cron 함수명을 알려주시겠습니까?"

TASK.md 완료기준이 모호하여 구현 방향 결정 불가
  → "완료기준 '결제 플로우 완성'의 범위를 명확히 해주세요.
     포함 여부 확인 필요: 부분취소 / 포인트 환불 / 쿠폰 복원"
```

---

### Class D: Critical — 즉시 세션 종료

```
발생 → 모든 작업 즉시 중단
    → .harness/telemetry/critical_audit.jsonl에 기록
    → Stephen에게 위반 내용 보고
    → 세션 종료 권고

에이전트 출력:
"🚨🚨🚨 [Class D] CRITICAL 위반 감지. 즉시 중단."
"위반 유형: {내용}"
"위반 코드: {해당 코드 스니펫}"
"권고 조치: 세션 종료 후 재시작"
"감사 기록: .harness/telemetry/critical_audit.jsonl"
```

**크레이지샷 적용 예시:**
```
TOSS_SECRET_KEY를 $env/static/public에 import 시도
  → Husky pre-commit 차단 + Class D 에스컬레이션

supabase/migrations/ 기존 파일 직접 수정 시도
  → 즉시 중단 + Class D 보고

.husky/pre-commit 수정 시도
  → 즉시 중단 + Class D 보고
```

**Critical Audit 기록 형식:**
```json
{
  "level": "CRITICAL",
  "timestamp": "2026-06-09T00:00:00.000Z",
  "error_class": "D",
  "violation_type": "SERVER_KEY_LEAK_ATTEMPT",
  "file_path": "src/routes/+page.svelte",
  "description": "TOSS_SECRET_KEY import in client-side code",
  "action_taken": "immediate_halt"
}
```

---

## 에러 분류 빠른 참조표

| Class | 유형 | 최대 재시도 | 에스컬레이션 |
|-------|------|-----------|------------|
| **A** | 네트워크/Rate Limit | 5회 + Backoff | → Class C |
| **B** | 컴파일/린트/테스트 | 3회 Self-Correct | → Class C |
| **C** | 의미론적 불일치 | 0회 (즉시) | → Stephen |
| **D** | 보안/가드레일 위반 | 0회 (즉시 종료) | → Stephen + 감사로그 |

---

## harness-executor와의 연계

```
Self-Correction Runner (G-3) 실패 판단:
  npm run check 실패 → Class B 분류 → 3회 시도
  API 타임아웃 → Class A 분류 → 5회 Backoff
  서버 키 노출 감지 → Class D → 즉시 중단

GATE C 반려 3회 → Class C → Stephen 에스컬레이션
sp3-qa-agent REJECT 3회 → Class C → Stephen 에스컬레이션
```

---

---

## 오인 카탈로그 (Misidentification Catalog)

Class A~D와 별개로 **도메인 해석 오인**을 누적 추적하는 전용 레코드.
컴파일 오류가 아닌 "구현은 됐으나 요구사항과 다른" 오인을 대상으로 한다.

### 기록 위치

`.harness/learnings/misidentifications.md`

### 기록 형식

```markdown
| 날짜 | 도메인 | 오인 내용 | 올바른 해석 | 원인 | 횟수 |
|------|--------|-----------|-------------|------|------|
| 2026-06-10 | M3 결제 | 웹훅 수신 후 9단계 동기 처리 구현 | 즉시 200 반환 + pg_cron 비동기 처리 | payment.md 참조 누락 | 1 |
```

### 기록 트리거

HOOK-7 발동 시 자동 캡처 (context-hook.md 참조):
- sp3 GATE E 반려
- G-0.5 불일치
- "내가 원한 게 아니야" 발언
- GATE C 반려 2회 연속

### 반복 오인 대응

```
동일 도메인 오인 2회 이상 감지:
  → "⚠️ 반복 오인 감지 ({N}회): {오인 내용}"
  → 해당 .claude/rules/*.md 파일의 관련 규칙 재검토 권고
  → TASK.md [CONTEXT BRIDGE]에 "반복 오인 주의: {내용}" 자동 추가

동일 오인 3회 이상:
  → Class C 에스컬레이션
  → "규칙 파일 갱신이 필요할 수 있습니다. Stephen 확인 요청."
```

### 세션 재시작 시 주입

HOOK-4 실행 시 misidentifications.md 최근 5건 자동 로드:
```
📋 재시작 브리핑 — 최근 오인 주의사항:
  ⚠️ {오인 내용 1줄} (도메인: {M2/M3/...}, {N}회 발생)
```

---

*ERROR_TAXONOMY.md v3.2 | Harness Flow | 에러 분류·에스컬레이션·오인 카탈로그*
