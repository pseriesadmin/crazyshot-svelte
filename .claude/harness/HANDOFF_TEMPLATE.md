# HANDOFF_TEMPLATE.md — 세션 핸드오프 프로토콜
# Harness Flow v3.2 | 엔터프라이즈 마스터 가이드 ch.8 구현체
# 참조: context-hook.md HOOK-5

---

## 핸드오프가 필요한 시점

```
아래 중 하나라도 해당되면 현재 세션을 압축하고 새 세션으로 이관:

SIGNAL-1: 대화가 100턴 이상 지속
SIGNAL-2: 동일 오류 3회 이상 반복 (Self-Correction 한계)
SIGNAL-3: 컨텍스트 리셋 후 흐름이 어색해짐
SIGNAL-4: Stephen이 "새 채팅으로 재시작"을 요청
SIGNAL-5: BLOCKED 항목이 3일 이상 지속됨
```

---

## 핸드오프 절차

### Step 1: 현재 세션 압축 지시

Stephen이 전달:
```
"세션 핸드오프 준비해줘.
 지금까지 진행상황, 남은 태스크, 주의사항을
 .claude/harness/HANDOFF.md에 요약해줘."
```

에이전트 동작:
```
1. TASK.md DONE 항목 집계
2. NOW/NEXT/BLOCKED 상태 확인
3. GSD_LOG.md 마지막 10개 항목 검토
4. .claude/harness/HANDOFF.md 생성
5. "핸드오프 문서 생성 완료. 새 채팅에서 아래 내용으로 시작하세요." 안내
```

### Step 2: 새 세션 시작 메시지

새 채팅에서 Stephen이 전달:
```
.claude/harness/HANDOFF.md 읽고 이어서 진행해줘.
B-START: [남은 태스크 중 첫 번째]
```

---

## HANDOFF.md 생성 형식

아래 형식으로 `.claude/harness/HANDOFF.md`에 저장:

```markdown
# 세션 핸드오프 문서
생성일: {YYYY-MM-DD HH:MM}
이전 세션 기간: {시작} ~ {종료}
작업 범위: {B-START 1줄 요약}

---

## 완료된 작업 (DONE)

{TASK.md DONE 항목 전체 복사}

주요 변경 파일:
- {파일 경로}: {변경 내용 1줄}
- {파일 경로}: {변경 내용 1줄}

---

## 진행 중 / 남은 작업

### NOW (즉시 재개할 것)
- [ ] {태스크명} | {GSD/TDD} | 완료기준: {1줄}
  → 현재 상태: {어디까지 했는가}
  → 다음 단계: {무엇을 해야 하는가}

### NEXT
{TASK.md NEXT 항목 전체}

### BLOCKED
{TASK.md BLOCKED 항목 + 차단 이유}

---

## 반드시 주의할 점

1. {중요 제약 사항 — 예: "auth.ts 파일의 legacy_handler 절대 삭제 금지"}
2. {진행 중 발견한 버그나 주의사항}
3. {다음 에이전트가 실수할 수 있는 패턴}

---

## 중요 결정 사항 (이번 세션에서 Stephen이 결정한 것)

- {결정 1}: {내용}
- {결정 2}: {내용}

---

## 미해결 질문

- {질문 1}: {컨텍스트}
- {질문 2}: {컨텍스트}

---

## 새 세션 시작 명령

아래를 새 채팅에 붙여넣으세요:

B-START: {TASK.md NOW 첫 번째 태스크}

또는 다음 사이클로 넘어갈 경우:
B-START: S1-M{다음 모듈번호}: {다음 모듈명} 구현
```

---

## 핸드오프 예시 (M2 → M3 전환)

```markdown
# 세션 핸드오프 문서
생성일: 2026-06-09 14:30
작업 범위: S1-M2 예약 플로우 TDD + S1-M3 결제 준비

## 완료된 작업

- [x] atomic_reserve_asset RPC 테스트 (Happy/Edge/Error 12개)
- [x] check_asset_availability TDD 완료
- [x] 예약 상태 머신 구현 (HOLD→confirmed→active→returned)
- [x] sp3-qa-agent GATE E 통과

## 진행 중 / 남은 작업

### NOW (즉시 재개할 것)
- [ ] M3-1: TossPayments SDK 통합 | TDD
  → 현재 상태: package.json에 @tosspayments/payment-sdk 설치됨
  → 다음 단계: /api/payment/confirm 서버 라우트 TDD 시작

### BLOCKED
- Supabase Realtime SSR WebSocket 이슈
  → 해결 방법: lazy 초기화 또는 ws 패키지 transport 제공
  → M4 진입 전 해결 필요

## 반드시 주의할 점

1. supabase/migrations/0002_reservation.sql 직접 수정 금지
   → 신규 ALTER는 0003_*.sql 파일로 작성
2. TOSS_SECRET_KEY는 $env/static/private에만
3. 웹훅 핸들러에서 동기 9단계 계산 금지 (Vercel 타임아웃)

## 새 세션 시작 명령

B-START: S1-M3: TossPayments 결제 통합 (TDD)
목표: /api/payment/confirm 라우트 + 웹훅 핸들러 구현
```

---

## 컨텍스트 리셋 없이 재개 가능한 신호

핸드오프 없이 같은 세션 계속 가능한 경우:
```
✅ TASK.md가 최신 상태
✅ GSD_LOG.md에 최근 변경 기록됨
✅ NOW 태스크가 명확
✅ BLOCKED 없음
✅ 이전 30턴 이내 작업
```

---

*HANDOFF_TEMPLATE.md v3.2 | Harness Flow | 세션 전환 프로토콜*
