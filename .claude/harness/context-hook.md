# context-hook.md — 크레이지샷 컨텍스트 롯 방지 훅 v3.1
# 위치: .claude/harness/context-hook.md
# 목적: 장시간 세션에서 AI 드리프트·컨텍스트 롯 방지
# 적용: harness-executor가 아래 조건 감지 시 자동 실행

---

## 감지 조건

아래 중 하나라도 해당되면 즉시 훅 실행. 구현 코드 먼저 작성하지 않는다.

```
HOOK-1: 이전 작업 참조 요청
  트리거: "아까", "이전에", "방금 전", "앞에서 만든",
          "기존 로직", "저번에", "같은 방식으로"

HOOK-2: 로직 재확인 요청
  트리거: "기억해", "어떻게 짰지", "로직이 뭐였지",
          "가격 계산 방식", "할인 순서", "단가 구조"

HOOK-3: UI·컴포넌트 작업
  트리거: "컴포넌트", "디자인", "UI", "레이아웃",
          "화면", "버튼", "모달", "탭", "카드"
  → 파일 경로가 src/routes/cms/ 또는 src/lib/components/cms/ 이면
    HOOK-3A (CMS 표준 디자인 시스템 확인) 자동 실행

HOOK-4: 새 채팅 재시작 후 첫 작업
  트리거: TASK.md 로드 직후 첫 번째 NOW 태스크 실행 시
```

---

## HOOK-1 — 이전 작업 참조 시

> 패턴: 없는 내용을 있다고 만들어내는 할루시네이션

```
1. 구현 중단
   "⏸ HOOK-1: 이전 작업 참조 요청. 파일 확인 후 진행."

2. 실제 파일에서 확인 (Read 툴)
   → TASK.md DONE 항목에서 완료 작업 확인
   → GSD_LOG.md에서 실제 구현 파일 경로 확인
   → 해당 파일 직접 Read

3. 확인 결과 출력 (1~2줄)
   "확인된 내용: [파일에서 읽은 것]"
   "확인 안 됨: [파일에 없는 것]"

금지:
❌ 파일 확인 없이 "아까 이렇게 했으니까" 추측 진행
❌ 존재하지 않는 함수명·파일 경로 생성
```

---

## HOOK-2 — 로직 재확인 시

> 패턴: 초반에 짠 로직과 다른 방식으로 재구현

```
1. 구현 중단
   "⏸ HOOK-2: 로직 확인 요청. 실제 파일을 읽겠습니다."

2. 핵심 로직 파일 직접 Read (우선순위 순)
   → calculate_cart_total RPC 파일
   → atomic_reserve_asset RPC 파일
   → 할인 계산 관련 파일

3. 읽은 내용 기반 현재 구현 상태 요약
   "현재 구현된 로직: [파일명] 기준
    - 할인 순서: [실제 코드에서 읽은 것]
    - 엣지케이스 처리: [실제 코드에서 읽은 것]"

4. NOW 태스크와 충돌 여부 확인
   충돌 있음 → Stephen에게 보고 후 대기
   충돌 없음 → 바로 진행

금지:
❌ 로직을 "기억"으로 재구성
❌ 파일 읽지 않고 "이렇게 돼있을 거예요" 추측
❌ 기존 로직과 다른 방식으로 조용히 재구현
```

---

## HOOK-3 — UI·컴포넌트 작업 시

> 패턴: 존재하지 않는 컴포넌트 임의 생성 / CMS 표준 디자인 토큰 미준수

```
1. 구현 전 체크리스트 출력
   "⏸ HOOK-3: UI 구현 진입. 컴포넌트 + 디자인 시스템 확인 먼저."

2. ⚠️ CMS 영역 여부 판별 (HOOK-3A — 최우선)
   파일 경로에 src/routes/cms/ 또는 src/lib/components/cms/ 포함 시 → HOOK-3A 즉시 실행

   HOOK-3A: CMS 표준 디자인 시스템 강제 확인
   ─────────────────────────────────────────────
   "⏸ HOOK-3A: CMS 영역 UI 작업. 표준 디자인 시스템 확인 필수."

   반드시 .claude/rules/cms-uiux.md Section 0 (CMS 표준 디자인 토큰 정본)을 Read하여
   아래 항목을 작업 전 선언할 것:

   "CMS 디자인 토큰 확인:
    [ ] 컬러: [사용할 토큰명] → [CSS 변수] 확인
    [ ] 버튼 반경: radius-base (8px = --radius-sm) — pill(30px) 아님
    [ ] 버튼 shadow: shadow-button (4px 4px 0px rgba(39,27,122,0.5))
    [ ] 토글 ON 색: primary-800 (#201857 = --cs-purple-dark) — --cs-purple 아님
    [ ] 구분선: border-default (#ECEBF4) 사용 여부
    [ ] 해당 컴포넌트 JSON 스펙 확인: [컴포넌트명] → [배경/텍스트/반경/패딩] 선언"

   구현 중 토큰 값 불확실 시 → 추측 금지, cms-uiux.md Section 0 재확인 후 진행
   허용 예외 하드코딩 목록 외 #hex / rgba 직접 입력 발견 시 → 즉시 수정 후 계속
   ─────────────────────────────────────────────

3. 사용할 컴포넌트 목록 선언
   "이 태스크에서 사용할 컴포넌트:
    - [컴포넌트명]: src/lib/comps/[경로] — 존재 확인 ✅/❌"

4. 존재하지 않는 컴포넌트 발견 시
   "⚠️ [컴포넌트명]이 src/lib/comps/에 없습니다.
    대체 가능 컴포넌트: [대안]
    새로 만들어야 하면 Stephen 확인 필요."
   → 임의로 새 컴포넌트 생성하지 않고 대기

5. CSS 변수·클래스 사전 확인
   → CMS 영역: cms-uiux.md Section 0 토큰 정본 기준
   → 일반 영역: ui-mobile.md + uiux.md에서 읽은 실제 값만 사용

6. 구현 완료 후 자가 체크
   "UI 자가 체크:
    [ ] 새 컴포넌트 생성 없음
    [ ] 하드코딩 색상 없음 (var(--) 사용) — 허용 예외 목록 외
    [ ] 터치 타겟 44px 이상
    (CMS 영역 추가)
    [ ] cms-uiux.md GATE C 확인 항목 전수 점검 완료
    [ ] JSON 컴포넌트 스펙과 구현 값 1:1 대조 완료"

금지:
❌ 컴포넌트 존재 확인 없이 import
❌ 없는 컴포넌트 임의 생성
❌ 하드코딩 색상값 사용
❌ CMS 영역에서 cms-uiux.md Section 0 미확인 채 UI 구현 시작
❌ CMS 버튼에 --radius-xl(30px) 사용 (--radius-sm 8px 사용)
❌ CMS 토글 ON에 --cs-purple 사용 (--cs-purple-dark 사용)
❌ src/app.css 미정의 CSS 변수 임의 생성
```

---

## HOOK-4 — 새 채팅 재시작 후 첫 작업

> 패턴: 이전 세션 맥락 없이 시작해서 방향 이탈

```
새 채팅에서 TASK.md 로드 직후 반드시 실행.

1. 현재 상태 파악 (Read 툴)
   → TASK.md: DONE / NOW / NEXT / BLOCKED 현황
   → GSD_LOG.md: 마지막 완료 태스크와 파일
   → TASK.md [CONTEXT BRIDGE]: 핵심제약·TDD도메인·절대금지·실패롤백

2. 재시작 브리핑 출력
   "📋 재시작 브리핑
    아젠다   : [CONTEXT BRIDGE 아젠다 요약]
    핵심제약 : [CONTEXT BRIDGE 핵심제약]
    완료     : [DONE 태스크 수]개
    현재 NOW : [태스크명]
    마지막 수정 파일: [GSD_LOG 마지막 항목]
    이어서 진행합니다."

3. 도메인 판별 후 실행 (GSD / TDD)

금지:
❌ TASK.md만 보고 바로 구현 시작
❌ GSD_LOG 확인 없이 "처음부터" 시작
❌ 이전 세션 내용을 "기억"으로 채우기
```

---

## HOOK-5 — SvelteKit 5 / Supabase 패턴 혼용 감지

> 패턴: Svelte 4 문법 또는 잘못된 Supabase 클라이언트 사용

```
트리거: svelte 컴포넌트 작성 / store 사용 / supabase 클라이언트 생성
        on:click / on:input / on:submit 문법 감지
        writable() / readable() import 감지
        createClient() 직접 호출 (SSR 외부에서)

1. 구현 중단
   "⏸ HOOK-5: SvelteKit 5 패턴 확인."

2. 체크리스트
   "Svelte 5 문법 체크:
    [ ] $state() 사용? (writable store 금지)
    [ ] $derived() 사용? (computed store 금지)
    [ ] $effect() 사용? (onMount 대체)
    [ ] $props() 사용? (export let 금지)
    [ ] onevent 핸들러? (on:event 금지)
    [ ] 서버/클라이언트 Supabase 클라이언트 올바르게 분리?"

3. 위반 감지 시
   "⚠️ Svelte 4 문법 감지: [구체적 위반 코드]
    수정 후 진행합니다."

금지:
❌ on:click / on:submit / on:input 사용
❌ writable() / readable() store import
❌ export let 대신 $props() 미사용
❌ 클라이언트에서 createClient(url, serviceRoleKey) 호출
```

---

## HOOK-7 — 오인 카탈로그 캡처 (Misidentification Capture)

> 패턴: 같은 도메인 오인이 세션마다 반복됨

```
트리거:
  - sp3-qa-agent GATE E 반려 (구현이 요구사항과 불일치)
  - G-0.5 설계-구현 불일치 발견
  - Stephen이 "이건 내가 원한 게 아니야" 발언
  - GATE C 반려 2회 이상 연속

1. 오인 캡처 선언
   "⏸ HOOK-7: 오인 발생 기록."

2. 오인 3항목 추출
   "무엇을 틀렸는가": {구현한 내용}
   "올바른 해석은": {실제 요구사항}
   "왜 틀렸는가": {원인 — 아젠다 모호 / 설계 출처 미확인 / 도메인 규칙 오해}

3. .harness/learnings/misidentifications.md에 추가
   형식:
   | {날짜} | {도메인} | {오인 내용 1줄} | {올바른 해석 1줄} | {원인} | {횟수} |

4. 같은 도메인 오인이 2회+ 시
   → AGENTS.md 해당 도메인 규칙 파일에 "⚠️ 반복 오인" 주석 추가 제안
   → "동일 오인 {N}회 감지. Stephen: {도메인} 규칙 명확화가 필요할 수 있습니다."

5. 세션 재시작 (HOOK-4) 시 자동 로드
   → misidentifications.md 최근 5건 CONTEXT BRIDGE에 주입

금지:
❌ 오인 발생 후 즉시 재구현 (캡처 없이)
❌ "다시 해보겠습니다" 만 출력 (원인 분석 없이)
```

---

## HOOK-6 — 세션 핸드오프 (컨텍스트 교체 프로토콜)

> 패턴: 대화가 너무 길어져 컨텍스트가 오염되거나 동일 오류 무한 반복

```
트리거:
  - Stephen: "새 채팅", "핸드오프", "컨텍스트 리셋"
  - Self-Correction 3회 실패 후 GATE C 반려 재발
  - 동일 에러가 5턴 이상 반복
  - BLOCKED 항목이 3일 이상 지속

1. 핸드오프 선언
   "⏸ HOOK-6: 세션 핸드오프 준비."

2. HANDOFF.md 생성 (HANDOFF_TEMPLATE.md 형식)
   → .claude/harness/HANDOFF.md에 저장
   
   포함 내용:
   - TASK.md DONE 항목 전체
   - NOW/NEXT/BLOCKED 현재 상태
   - 이번 세션에서 발견한 주의사항 (오류 패턴 포함)
   - Stephen이 결정한 사항 목록
   - 새 세션 시작 명령 (복붙용)

3. 완료 안내
   "✅ HANDOFF.md 생성 완료.
    새 채팅에서: '.claude/harness/HANDOFF.md 읽고 이어서 진행해줘.'
    이후 B-START로 재시작."

금지:
❌ HANDOFF.md 없이 새 채팅 재시작 (컨텍스트 유실)
❌ 핸드오프 없이 "기억으로" 재개
```

---

## HOOK-8 — BLOCKED 자동 감지 및 스킵 제안

```
트리거:
  - TASK.md BLOCKED 항목이 2일 이상 변동 없음
  - BLOCKED 항목이 가장 앞 NOW를 막고 있음
  - Stephen: "다음", "스킵", "넘어가" 입력

1. 상황 파악 (파일 Read)
   → TASK.md BLOCKED 항목 전체 확인
   → 각 항목의 차단 원인 분류:
      [외부] Supabase/API/외부 서비스 이슈 → 우회 방안 탐색
      [결정] Stephen 결정 대기 → 즉시 질문
      [기술] 기술 난이도 → 대안 구현 탐색

2. BLOCKED 처리 옵션 제시 (harness-executor 5b 포맷 사용)

3. "스킵" 선택 시
   → BLOCKED 항목 BACKLOG 이동 + 이유 기록
   → 다음 NEXT 태스크로 NOW 재지정
   → "⏭ {태스크명} 스킵 완료. 다음: {새 NOW 태스크명} 진행합니다."

4. "결정 대기" 선택 시
   → HOOK-6 (HANDOFF) 실행 권고
```

---

## Stephen이 직접 입력하는 명령

```
"컨텍스트 체크"  → HOOK-4 재시작 브리핑 실행
"파일 확인해"    → HOOK-1 실행 (추측 없이 실제 파일 Read)
"로직 읽어"      → HOOK-2 실행 (핵심 로직 파일 직접 Read)
"컴포넌트 확인"  → HOOK-3 Step 2~3 실행
"CMS 디자인 확인" → HOOK-3A 실행 (cms-uiux.md Section 0 강제 Read + 토큰 선언)
"스벨트 확인"    → HOOK-5 실행 (SvelteKit 5 패턴 체크)
"핸드오프"       → HOOK-6 실행 (세션 압축 + HANDOFF.md 생성)
"오인 기록"      → HOOK-7 실행 (misidentifications.md 캡처)
"스킵" / "다음"  → HOOK-8 실행 (BLOCKED 항목 처리 + 다음 NOW)
"에러 분류"      → ERROR_TAXONOMY.md 참조 후 Class 판별 안내
```

---

## harness-executor 연동

harness-executor 실행 전 다음 한 줄 확인:
```
실행 전: context-hook.md 훅 조건 스캔.
         트리거 감지 시 해당 HOOK 실행 후 진입.
         
Self-Correction 3회 실패 → HOOK-6 권고 (세션 핸드오프)
Class D 에러 감지 → 즉시 중단 (ERROR_TAXONOMY.md 참조)
```

---

*context-hook.md v3.2 | Harness Flow v3.2 | 컨텍스트 롯 방지 + 세션 핸드오프 + Error Taxonomy 연동*
