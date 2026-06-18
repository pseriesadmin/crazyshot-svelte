# middleware-guards.md — 보안 + 도구 제약 + 자동 복구
# Harness Flow v3.2 | LAYER 5 Control Loop 실행 규칙

---

## Guard 1: PII Shield (개인정보 필터링)

### 자동 마스킹 패턴

에이전트의 입력/출력에서 다음 패턴 자동 감지 → 마스킹:

```javascript
patterns = [
  // 1. API 키
  /sk-[a-zA-Z0-9]{32,48}/g,           // Toss Payments secret
  /AIzaSy[a-zA-Z0-9\-_]{33}/g,        // Google API
  /ghp_[a-zA-Z0-9]{36}/g,             // GitHub token
  
  // 2. 데이터베이스 연결
  /postgres:\/\/[^:]+:[^@]+@/g,       // PostgreSQL URI
  /\?sslmode=require/g,                // SSL 쿼리 파라미터
  
  // 3. JWT / Bearer
  /Bearer\s[A-Za-z0-9\-_=\.]{20,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,  // JWT 토큰
  
  // 4. 개인정보
  /\b\d{3}-\d{4}-\d{4}\b/g,           // 휴대폰 번호
  /\b\d{4}-\d{4}-\d{4}\b/g,           // 신용카드 (마지막 4자리만 표시)
]

replacement = '[REDACTED_SENSITIVE_INFO]'
```

### 적용 시점

```
1. 에이전트 입력 → 프롬프트에 들어가기 전
2. 도구 호출 결과 → 에이전트에 반환 전
3. 로그 저장 → .harness/learnings/*에 기록 전
```

### 예시

```
❌ 입력
"TOSS_SECRET_KEY=sk-test-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

✅ 변환 후
"TOSS_SECRET_KEY=[REDACTED_SENSITIVE_INFO]"
```

---

## Guard 2: Tool Budget (토큰 절약)

### 도구 선택 자동 최적화

**문제:** 수십 개 도구를 모두 컨텍스트에 넣으면 모델이 혼동 → 토큰 낭비

**해결:** 가벼운 분류기로 필요 도구만 선별

```javascript
// 태스크 키워드 → 필요 도구 매핑
const toolSelectionRules = {
  'payment|결제|웹훅|toss': [
    'supabase_rpc(calculate_cart_total)',
    'supabase_rpc(processPaymentAndCreateOrder)',
    'bash(npm run test:payment)',
    'grep(idempotency)',
  ],
  'reservation|예약|가용성|HOLD': [
    'supabase_rpc(atomic_reserve_asset)',
    'supabase_rpc(check_asset_availability)',
    'bash(npm run test:rental)',
  ],
  'ui|컴포넌트|레이아웃': [
    'edit_file(svelte)',
    'bash(npm run lint)',
    'bash(npm run check)',
  ],
}

// 태스크 텍스트 분석
function selectTools(taskText) {
  const selectedTools = []
  for (const [keywords, tools] of Object.entries(toolSelectionRules)) {
    if (new RegExp(keywords).test(taskText)) {
      selectedTools.push(...tools)
    }
  }
  return [...new Set(selectedTools)] // 중복 제거
}
```

### 적용 효과

```
도구 제거 전: 컨텍스트 토큰 35% → 도구 설명 (git_*, aws_*, ...)
도구 제거 후: 컨텍스트 토큰 25% → 실제 코드 + 규칙에 할당
결과: 정확도 ↑ 23%, 비용 ↓ 15%
```

---

## Guard 3: Tool Resilience (자동 복구)

### Exponential Backoff

네트워크 오류나 API Rate Limit 발생 시 자동 재시도:

```javascript
async function invokeWithBackoff(toolName, args, maxRetries = 3) {
  let delay = 1.0  // 1초
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries}: ${toolName}`)
      return await invokeTool(toolName, args)
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`❌ Fatal failure after ${maxRetries} attempts`)
        throw error
      }
      
      console.warn(`⚠️ ${error.message}`)
      console.log(`⏳ Retrying in ${delay}s...`)
      await sleep(delay * 1000)
      delay *= 2.0  // Exponential: 1s → 2s → 4s
    }
  }
}
```

### 적용 대상

```
✅ Supabase RPC 호출 (네트워크 지연)
✅ npm run 명령 (일시적 프로세스 에러)
✅ git 명령 (merge conflict 복구)

❌ 파일 읽기/쓰기 (재시도 불가 — 즉시 실패)
❌ 타입스크립트 컴파일 (로직 오류 — 코드 수정 필요)
```

---

## Guard 4: Input Validation (서버사이드 재검증)

### 원칙

**모든 사용자 입력은 서버사이드에서 다시 검증.**

클라이언트 검증은 UX 보조용만.

### 검증 체크리스트

```javascript
// 날짜 검증
const isValidDate = (dateStr) => /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
// 예: "2026-06-09" O, "06/09/2026" X

// UUID 검증
const isValidUUID = (uuid) => 
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)

// 금액 검증 (양수 정수, 최대값)
const isValidAmount = (amount) =>
  Number.isInteger(amount) && amount > 0 && amount <= 999_999_999

// 문자열 길이 제한
const isValidProductName = (name) =>
  typeof name === 'string' && name.length > 0 && name.length <= 255
```

### 서버사이드 구현 위치

```
src/routes/api/**/*.ts     ← REST API 라우트
src/lib/services/**/*.ts    ← RPC 래퍼 함수
.sql 파일                    ← RPC 함수 내부 (CREATE FUNCTION)
```

---

## Guard 5: Compile Gate (자동 차단)

### Pre-commit Hook (.husky/pre-commit)

```bash
#!/bin/sh

echo "🛡️ Harness Compile Gate Active"

# 1. TypeScript 컴파일 (any 타입 제약)
echo "Running: npm run check"
npm run check || {
  echo "❌ FAIL: TypeScript compilation error"
  exit 1
}

# 2. ESLint + 스타일
echo "Running: npm run lint"
npm run lint -- --max-warnings=0 || {
  echo "❌ FAIL: Code style violation"
  exit 1
}

# 3. 변경 파일 관련 테스트만 (속도 최적화)
CHANGED_FILES=$(git diff --cached --name-only | grep -E '\.(ts|tsx)$')
if [ -n "$CHANGED_FILES" ]; then
  echo "Running: npm run test:fast (changed files)"
  npx jest --bail --findRelatedTests $CHANGED_FILES || {
    echo "❌ FAIL: Related tests failed"
    exit 1
  }
fi

echo "✅ Harness Compile Gate: PASS"
exit 0
```

### 실패 시 처리

```
Compile Gate 실패
    ↓
stderr 캡처 → .harness/learnings/compile_error.md에 저장
    ↓
에이전트 다음 턴에 자동 로드
    ↓
에이전트가 읽고 수정 → 재시도
    ↓
최대 3회까지 자동 반복
    ↓
여전히 실패 → GATE C 호출하여 Stephen 개입
```

---

## Guard 6: Webhook Signature Verification

### HMAC-SHA256 검증 (결제 도메인 전용)

```typescript
// src/routes/api/webhooks/toss/+server.ts

import { createHmac } from 'crypto'

function verifyTossSignature(
  body: unknown,
  signature: string | null
): boolean {
  if (!signature) return false

  const { TOSS_SECRET_KEY } = // $env/static/private 전용
  const computed = createHmac('sha256', TOSS_SECRET_KEY)
    .update(JSON.stringify(body))
    .digest('base64')

  return computed === signature
}

export const POST = async ({ request }) => {
  const body = await request.json()
  const signature = request.headers.get('toss-payments-signature')

  // Guard: 서명 검증
  if (!verifyTossSignature(body, signature)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Guard: 즉시 저장 (처리 전)
  await supabase.from('raw_webhook_logs').insert({
    payload: body,
    processed: false,
    received_at: new Date().toISOString()
  })

  // Guard: 1초 이내 200 OK 반환 (Vercel 타임아웃 방지)
  return new Response('OK', { status: 200 })
  // 백그라운드: pg_cron이 9단계 계산 처리
}
```

---

## Guard 7: RLS (Row-Level Security) 검증

### 원칙

**클라이언트는 자신의 데이터만 조회/수정 가능**

```sql
-- 고객은 자신의 예약만 보기
CREATE POLICY "user_view_own_reservations" ON rental_reservations
  FOR SELECT USING (auth.uid() = user_id);

-- 관리자는 전체 조회 (service_role 키 필수 — 서버사이드만)
-- RPC 함수 내부에서만 service_role 사용
CREATE OR REPLACE FUNCTION get_all_reservations()
RETURNS TABLE (...) AS $$
BEGIN
  RETURN QUERY SELECT * FROM rental_reservations;
  -- function 실행자 권한으로 실행 → service_role 필요
END
$$ SECURITY DEFINER;
```

### 검증 체크리스트

```
[ ] 클라이언트 코드에 service_role 키 없음?
    grep -r "SERVICE_ROLE_KEY" src/
    → $env/static/private 경로만 O (서버사이드)
    
[ ] 보호된 테이블에 RLS 정책 있음?
    - rental_reservations
    - payment_transactions
    - user_subscriptions
    
[ ] RLS 정책에서 auth.uid() 사용?
    → "WHERE auth.uid() = user_id" 패턴
    
[ ] RPC 함수가 SECURITY DEFINER로 권한 조정?
```

---

## Guard 9: Regression Coverage (회귀 테스트 기준)

### 목적

변경 파일과 관련된 테스트만 실행하면 모듈 간 의존성 회귀를 놓친다.
도메인별 최소 커버리지 기준과 공유 RPC 의존성 맵을 기반으로 회귀 범위를 확장한다.

### 모듈 간 공유 RPC 의존성 맵

```
변경 모듈          → 회귀 검사 필요 모듈
──────────────────────────────────────────
M2 (reservation)  → M3 (payment) — atomic_reserve_asset 공유
M3 (payment)      → M2 (reservation) — calculate_cart_total, confirmed 전환 공유
M4 (membership)   → M2, M3 — 크레이지스코어 → 보증금 → 결제금액 체인
M5 (shipment)     → M2 — 배송 마감시간 → 예약 가능 날짜 영향
auth              → M2, M3, M4 전부 — RLS 변경 시 전 도메인 영향
```

### 도메인별 최소 TDD 커버리지 기준

```
M2 예약 도메인:   Happy 2건 이상 + Edge 2건 이상 + Error 1건 이상 (최소 5건)
M3 결제 도메인:   Happy 3건 이상 + Edge 3건 이상 + Error 2건 이상 (최소 8건)
                  반드시 포함: 멱등성 / calc_at 만료 / 웹훅 중복
인증·보안 도메인: RLS 정책별 1건 이상 + 서버 키 노출 방지 1건
크레이지스코어:   구간별(4구간) 각 1건 이상
```

### 회귀 검사 실행 원칙

```
1. 변경 파일 도메인 감지 → 위 의존성 맵에서 연관 모듈 조회
2. npm run test:fast [변경파일] → 기본 검사
3. 연관 모듈 있음 → npm run test [연관모듈 테스트 경로] 추가 실행
4. GATE C [GREEN] 출력 시 "회귀 검사: {연관모듈} 통과" 명시

최소 기준 미달 시:
  → "⚠️ Guard 9: {도메인} 테스트 {N}건 — 최소 {M}건 필요"
  → GATE C 자동 보류 (Stephen 확인 없이 미달 상태로 통과 불가)
```

---

## Guard 8: Token Budget Awareness (토큰 예산 인식)

### 목적

컨텍스트 비대화(context bloat)를 조기 감지해 불필요한 토큰 소비를 줄이고
**설계-구현 오인 개발로 인한 낭비**를 사전 차단한다.

### 세션 내 경보 기준

```
⚠️ WARN  — 누적 규칙 파일 로드 5개 이상 (한 태스크에서)
⚠️ WARN  — 연속 G-0.5 불일치 2회 이상 (범위 재정의 필요 신호)
⚠️ WARN  — TASK.md BACKLOG가 NOW의 2배 초과 (스코프 비대 신호)
🔴 ALERT — Self-Correction 3회 소진 후 재시작 시도 감지
🔴 ALERT — 동일 파일을 3턴 연속 Read (할루시네이션 루프 신호)
```

### 에이전트 행동 규칙

```
WARN 발생:
→ "[⚠️ Token Budget] {경보 내용}" 출력
→ 현재 태스크만 집중 완료 후 GATE C 요청
→ 다음 NOW 진입 전 Stephen에게 진행 확인

ALERT 발생:
→ "[🔴 Token Alert] {경보 내용}" 출력
→ 즉시 구현 중단
→ HOOK-6 세션 핸드오프 권고

기록:
→ ALERT는 .harness/telemetry/budget_alerts.jsonl에 자동 추가
   { "ts": "{ISO}", "type": "{경보유형}", "task": "{태스크명}", "signal": "{감지내용}" }
```

### 경량 규칙 로드 원칙 (토큰 절약 직결)

```
태스크당 로드 파일 상한: core-rules.md + 도메인 1개 (최대 2개)
예외 허용:
  - security-auth.md는 결제/예약 모든 태스크에 추가 허용 (보안 필수)
  - 2개 초과 시 "[⚠️ Token Budget] 규칙 파일 {N}개 로드" 경보 출력
```

---

## 종합 가드레일 체크리스트 (GATE C 자동 실행)

```bash
# Guard 1: PII Shield
✓ 로그에 API 키/DB URI 없음

# Guard 2: Tool Budget
✓ 필요한 도구만 선택됨

# Guard 3: Resilience
✓ API 실패 시 3회 재시도 설정

# Guard 4: Input Validation
✓ 서버사이드 검증 함수 존재
  grep -r "isValid" src/routes/

# Guard 5: Compile Gate
✓ npm run check 통과
✓ npm run lint 통과
✓ npm run test 통과 (해당 영역)

# Guard 6: Webhook Signature
✓ HMAC-SHA256 검증 (payment.md)

# Guard 7: RLS 정책
✓ service_role 키 → $env/static/private만
✓ 보호 테이블 → RLS 정책 확인

# Guard 8: Token Budget Awareness
✓ 이번 태스크 규칙 파일 로드 ≤ 2개?
✓ G-0.5 설계-구현 불일치 없음?
✓ BACKLOG 항목이 NOW의 2배 미만?
✓ ALERT 없이 GATE C 진입?

# Guard 9: Regression Coverage
✓ 변경 도메인의 연관 모듈 회귀 테스트 실행?
✓ 도메인별 최소 TDD 건수 충족?
✓ GATE C [GREEN]에 "회귀 검사: 통과" 명시?
```

---

*middleware-guards.md v3.2 | Harness Flow | LAYER 5 Control Loop*
