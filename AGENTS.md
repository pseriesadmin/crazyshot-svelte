# AGENTS.md — 크레이지샷 (Crazyshot)
# Harness Flow v3.0 | 시범서비스 오픈 목표 W1~W12
# "자동이 막고, 사람이 방향을 잡는다."

---

## 프로젝트 정체성

```
서비스명   : 크레이지샷 (crazyshot.kr)
성격       : 촬영장비 전문 렌탈 플랫폼 (B2C + 글로벌 K-POP 팬층)
목표       : 시범서비스 오픈 (W1~W12, 3개월)
개발방식   : 1인 AI 에이전틱 코딩 | Claude Code | Harness Flow v3.0
스택       : SvelteKit + TypeScript · Supabase · Vercel · 토스페이먼츠 v2
```

---

## 황금 원칙

```
GP-1.  git 명령어는 Stephen만 직접 실행 (add / commit / push 전부)
GP-2.  GATE B·C·E 전환은 Stephen의 명시적 승인 후에만 진행
GP-3.  AI는 제안·실행, 결정은 Stephen
GP-4.  TDD 도메인은 테스트 없이 구현 코드 작성 금지
GP-5.  30분 초과 GSD / 15분 초과 TDD 태스크는 분해 후 재승인
GP-6.  불확실하면 즉시 멈추고 Stephen에게 질문
GP-7.  명시 범위 밖 기능 선제 구현 금지
GP-8.  컨텍스트 리셋 요청 시 TASK.md + GSD_LOG.md 즉시 재로드
GP-9.  서버 전용 키는 절대 클라이언트 코드에 노출 금지
GP-10. 기존 마이그레이션 파일 직접 수정 금지 (새 파일로 ALTER 처리)
```

---

## TDD 강제 도메인

아래 키워드가 아젠다에 포함되면 무조건 TDD 경로, 15분 단위 분해.

```
결제·정산   : payment / 결제 / 환불 / 보증금 / 토스 / 웹훅 /
              idempotency / 혼합결제 / 쿠폰 / 포인트 / 정산 / VAT

예약·재고   : reservation / 예약 / 가용성 / 이중예약 /
              atomic_reserve / 임시점유 / HOLD / 재고

핵심 RPC    : calculate_cart_total / atomic_reserve_asset /
              batch_atomic_reserve / check_delivery_deadline /
              subscribe_plan / cancel_subscription / get_credit_score

보안·권한   : auth / RLS / JWT / 인증 / 접근제어

특화 로직   : 크레이지스코어 / 할인순서 / 9단계 / canProceed /
              calc_at / Vision Agent / confidence
```

---

## GSD 도메인

```
UI·화면     : UI / 컴포넌트 / 화면 / 레이아웃 / 스타일
데이터관리  : CRUD / 목록 / 등록 / 수정 / 삭제 / 조회
사용자관련  : 회원정보 / 마이페이지 / 프로필 / 설정
커뮤니케이션: 알림 / 푸시 / 이메일
```

---

## 에이전트 호출 순서 (v3.0 — GATE 3개)

```
[B-START] 아젠다 작성           👤 Stephen
          ↓
@harness-executor               🤖 TASK.md 생성
          ↓
GATE B  태스크 확인             👤 Stephen (승인 필수)
          ↓
@harness-executor               🤖 NOW 태스크 실행
   또는 @sp2-tdd-agents         🤖 TDD 도메인 시
          ↓
GATE C  결과물 확인 (매루프)    👤 Stephen
          ↓
@sp3-qa-agent                   🤖 전체 검수 (GATE C 마지막 루프 후)
          ↓
GATE E  최종 확인               👤 Stephen → 커밋 허가 → 👤 git
          ↓
@sp4-deploy-agent               🤖 시범서비스 배포 체크리스트
```

대형 아젠다(DB 설계·모듈 전체 설계 등) 한정으로 @promptor 선행 호출 가능:
```
@promptor → 분석 결과 검토 → [B-START] 작성 → 위 순서대로
```

---

## 절대 금지 패턴

```typescript
// ❌ 직접 INSERT (이중예약 위험) — H-01 자동 차단
await supabase.from('rental_reservations').insert({...})
// ✅ await supabase.rpc('atomic_reserve_asset', {...})

// ❌ 클라이언트 가격 계산 (조작 위험)
const price = basePrice * 0.9;
// ✅ await supabase.rpc('calculate_cart_total', {...})

// ❌ 재고 확인 없이 결제창 오픈
toss.requestPayment({...})
// ✅ atomic_reserve_asset → 성공 확인 → requestPayment

// ❌ 웹훅 수신 후 동기로 9단계 계산 (Vercel 타임아웃 위험)
await calculateCartTotal(webhookPayload)  // 최대 10초+
return new Response('OK')
// ✅ 웹훅은 즉시 저장 → 200 OK → pg_cron 백그라운드 처리
await supabase.from('raw_webhook_logs').insert({payload, processed: false})
return new Response('OK', { status: 200 })  // 1초 이내

// ❌ 만료 필터 없는 가용성 조회
.in('status', ['temp', 'confirmed'])
// ✅ .or(`status.eq.confirmed,and(status.eq.temp,expires_at.gt.${now})`)

// ❌ 서버 키 클라이언트 노출 — Husky 자동 차단
import { TOSS_SECRET_KEY } from '$env/static/public'
// ✅ import { TOSS_SECRET_KEY } from '$env/static/private'

// ❌ 기존 마이그레이션 파일 직접 수정 — Husky 자동 차단
// ✅ 새 파일로 ALTER 처리
```

---

## 도메인 규칙 파일

```
.claude/rules/
├── core-rules.md         ← 개발 실행 원칙
├── rental.md             ← 렌탈·예약·가용성
├── payment.md            ← 결제·환불·PG
├── ui-mobile.md          ← 모바일 UX 기준
└── security-auth.md      ← 인증·권한·RLS
```

---

## 디렉토리 구조

```
crazyshot-svelte/
├── AGENTS.md
├── s0-setup.sh                   ← 자동 강제 시스템 설치 (실행 후 삭제)
├── .claude/
│   ├── agents/
│   │   ├── promptor.md           ← 대형 아젠다 분석 (선택)
│   │   ├── harness-executor.md   ← GSD+TDD 통합 실행 (핵심)
│   │   └── shared/
│   │       ├── sp2-tdd-agents.md
│   │       ├── sp3-qa-agent.md
│   │       └── sp4-deploy-agent.md
│   └── harness/
│       ├── TASK.md               ← NOW 태스크
│       ├── GSD_LOG.md            ← 실행 이력
│       ├── ROLLBACK_LOG.md       ← 반려·롤백 이력
│       └── context-hook.md       ← 컨텍스트 롯 방지
└── src/ ...
```

---

*AGENTS.md | Harness Flow v3.0 | crazyshot 시범서비스 오픈 목표*
