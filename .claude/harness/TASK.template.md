# TASK.template.md — 새 TASK.md 작성 참조 템플릿
# Harness Flow v3.2 | harness-executor가 TASK.md 생성 시 이 형식을 따른다
# 위치: .claude/harness/TASK.template.md (정본 유지 위치)

---

## 사용 방법

harness-executor가 [B-START] 아젠다를 받으면 아래 형식으로
`.claude/harness/TASK.md`를 생성한다. 이 파일을 직접 편집하지 않는다.

---

## 템플릿

```
# .claude/harness/TASK.md
생성일: {YYYY-MM-DD HH:mm}
아젠다: {아젠다 1줄 요약}

[CONTEXT BRIDGE]
plan_source: {Figma URL / PRD 섹션 / 구두 지시 등 출처}
핵심제약:
  - 완료조건: {서비스 관점에서 "언제 끝났다고 볼 수 있나"}
  - 금지사항: {이 작업 중 절대 하지 말아야 할 것}
  - 모킹 범위: {dev/테스트 환경에서 모킹 처리할 항목 (없으면 생략)}
TDD도메인: {있음 (키워드: {해당 TDD 키워드}) / 없음 (GSD 도메인)}
절대금지:
  - {금지1}
  - {금지2}
실패롤백:
  - {롤백 절차 1}
  - {롤백 절차 2}

---

## NOW
- [ ] {태스크명} | {GSD/TDD} | 완료기준: {기준} | 예상: {N}분
- [ ] {태스크명} | {GSD/TDD} | 완료기준: {기준} | 예상: {N}분

## DONE
(완료된 태스크 이동)
- [x] {태스크명} | {GSD/TDD} | 완료기준: {기준} | 완료: {실제소요}분

## BLOCKED
- ⚠️ {태스크명}: {막힌 이유 + 해결 조건}

## BACKLOG
- {향후 작업 항목 (TODO/FIXME 포함)}
```

---

## 작성 규칙

```
태스크 단위  : 15~25분 (초과 시 분할)
TDD 도메인   : 결제·예약·보안·크레이지스코어 포함 시 반드시 TDD 표시
완료기준     : "렌더링 된다" (X) → "상품명·이미지·렌탈료가 화면에 표시된다" (O)
NOW 개수     : 한 번에 3~7개 (너무 많으면 BACKLOG로)
plan_source  : 출처 없으면 "구두 지시 {날짜}" 형식
```

---

## GATE B 출력 형식 (TASK.md 생성 후 Stephen 승인 요청)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 GATE B — 이 작업을 진행해도 될까요?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
무엇을 만드나요: {서비스 관점 1줄}
범위: {파일/컴포넌트 목록}
순서:
  1. {태스크명} — {완료기준} (예상 {N}분)
  2. ...
주의사항: {CRITICAL 등급 항목 (없으면 생략)}
진행하면 될까요? (응/수정)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

*TASK.template.md | Harness Flow v3.2 | 정본: .claude/harness/*
*커서 참조: @.claude/harness/TASK.template.md*
