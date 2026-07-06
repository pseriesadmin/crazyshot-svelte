# HANDOFF.md — AI 세션 인수인계
# Harness Flow v3.2 | Claude Code ↔ Cursor AI 전환 시 필수 갱신
# 형식: AI_COLLAB_PROTOCOL.md 원칙 C 기준

---

## 현재 상태 (2026-07-06 갱신)

### 1. 의도
S1-M2 Reservation REFACTOR 완료 — reservationHelper.ts UUID 타입 정합 + RPC 타입 에러 해소.
svelte-check: 3 ERRORS → 2 ERRORS (pre-existing behaviorTracker + carousel 잔여).

### 2. 건드린 파일
```
src/lib/services/reservationHelper.ts         [ReservationInput.productId: number→string, UUID_RE 검증]
src/__tests__/services/reservationHelper.test.ts [productId 테스트값 UUID 형식으로 업데이트]
src/routes/products/[id]/+page.server.ts       [get_product_option_links RPC 타입 캐스팅 + console.error 제거]
CLAUDE.md                                      [S1-M2 상태: DONE으로 업데이트]
```

### 3. 금지
```
- 20260703000049_49_product_option_links.sql 직접 사용 금지 (62로 대체됨)
- src/lib/services/supabase.ts 수정 금지 (baseline: fed4fdb)
- src/hooks.server.ts 수정 금지
- src/routes/api/** 수정 금지
- supabase/migrations/** 신규 ADD 외 수정 금지
```

### 4. 오인 주의
```
- stage + production products.id: 이제 UUID (이전: bigint 9~16)
  기존 /products/9 등 정수 ID URL 무효 → CMS 목록에서 UUID로 접근
- production assets 9행: bigint product_id → UUID 매핑 이전 완료 (데이터 보존)
- Migration 63 적용 후 get_product_option_links RPC 반환에 min_select_required 포함
```

### 5. 다음 한 단계
```
S1-M2 REFACTOR 완료.
다음 사이클: S1-M3 Payment 추가 작업 또는 S1-M4 Subscriptions.
잔여 pre-existing 에러 2건:
  - src/lib/analytics/behaviorTracker.ts:55 — RPC 타입 미등록 (별도 모듈)
  - src/routes/+page.svelte:301 — carousel scrollBy 타입 (별도 모듈)
plannode v1.59: products UUID 마이그레이션 + option_links 노드 추가 필요 (미작업)
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
