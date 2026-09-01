# DRIFT_CHECK_PROCEDURE.md — Stage↔Production DB 드리프트 검증 절차
# Harness Flow v3.2 | 2026-09-01 신설

---

## 왜 이 문서가 존재하는가

2026-09-01, production DB에서 `promote_draft_reservation` RPC가 통째로 누락돼 있어
장바구니 "예약신청"이 12일간(2026-08-20 Migration #315 이후) 전면 실패 상태였다.
CMS 백오피스 정밀 검증 v5(35개 화면 전수검수)조차 이 결함을 잡지 못했다 — 그 검증이
"화면·기능이 동작하는가"만 봤지, "stage와 production의 실제 DB 객체(함수·정책·권한)가
서로 같은가"는 아무도 체계적으로 비교하지 않았기 때문이다.

이 문서는 그 공백을 메운다. **CRITICAL 등급 마이그레이션을 stage+production 양쪽에
적용했다고 TASK.md에 "완료"로 기록하기 전에, 반드시 이 절차를 실행해 실제 두 DB가
일치하는지 직접 확인한다.** 사후 기록이 아니라 사전 게이트로 동작해야 하므로,
`sp3-qa-agent`(검수 3단계)와 `sp4-deploy-agent`(Production 배포 체크리스트) 양쪽에
이 절차 실행이 명시적으로 강제되어 있다(각 파일 참고).

## 왜 로컬 스크립트가 아니라 절차서(runbook)인가

이 프로젝트는 `.env.local`이 stage(ezyvffjvuwmtuhpxdjrw)에만 연결되고 production
(vnbpmvxruyciuuaermyh) 자격증명은 Vercel 프로덕션 환경에만 존재하도록 의도적으로
분리돼 있다(core-rules.md "Supabase — DB 환경 분리", "절대 혼용 금지"). 이 분리 자체가
실수로 잘못된 DB에 쓰기를 하는 사고를 막는 안전장치이므로, 두 DB 자격증명을 동시에 쥔
로컬 스크립트를 만드는 것은 오히려 새로운 위험(그 스크립트가 유출되거나 오동작하면
두 DB 모두에 영향)을 추가하는 것이다.

대신 Claude Code 세션이 이미 갖고 있는 Supabase MCP 도구(`project_id`로 명시적으로
프로젝트를 구분해 호출)를 그대로 쓰되, **무엇을 비교해야 하는지를 매번 새로 추론하지
않도록** 아래에 실행할 쿼리를 고정 목록으로 박아둔다.

---

## 실행 시점 (필수)

```
① CRITICAL 등급 마이그레이션을 stage+production 양쪽에 apply_migration 완료 직후
② TASK.md에 "Stage+Production 양쪽 적용 완료"로 기록하기 직전
③ sp3-qa-agent가 "DB 안전성" 항목을 검수할 때(해당 태스크가 신규/변경 RPC를 포함하면)
④ sp4-deploy-agent가 Production 배포 체크리스트를 안내하기 전
⑤ 과거 마이그레이션이 "누락 의심"으로 재조사될 때(오늘의 promote_draft_reservation처럼)
```

---

## 절차 1 — 함수(RPC) 정의 대조

이번 태스크가 새로 만들거나 수정한 함수 이름을 전부 나열한 뒤, 양쪽 project_id에
동일 쿼리를 각각 실행해 `pg_get_functiondef` 결과를 diff한다.

```sql
-- {project_id}를 stage(ezyvffjvuwmtuhpxdjrw)와 production(vnbpmvxruyciuuaermyh)
-- 양쪽에 각각 실행하고 결과를 비교한다.
SELECT proname, pg_get_functiondef(p.oid) AS def
FROM pg_proc p
WHERE proname = ANY(ARRAY['함수명1', '함수명2', '...']);
```

**빈 배열이 반환되면 그 함수가 해당 프로젝트에 아예 존재하지 않는다는 뜻** — 이번
promote_draft_reservation 사고가 정확히 이 신호였다. 결과가 비어있는데 원래 있어야
할 함수라면 즉시 CRITICAL로 취급하고 재적용한다.

## 절차 2 — 권한(GRANT) 대조

CREATE OR REPLACE는 기존 GRANT를 보존하지만, **신규 생성**되는 함수는 Supabase 프로젝트의
`ALTER DEFAULT PRIVILEGES`가 `anon`에게 자동으로 EXECUTE를 부여한다(Migration #260에서
`pg_default_acl` 직접 조회로 확인된 프로젝트 전역 설정 — 2026-09-01 promote_draft_reservation
재생성 시 실제로 재현됨). `REVOKE ALL FROM PUBLIC`은 `PUBLIC` 의사역할에만 적용되고 `anon`은
별개 권한주체라 영향받지 않으므로, 신규/재생성 함수는 반드시 아래로 실제 부여 상태를 확인한다.

```sql
SELECT r.routine_name, g.grantee, g.privilege_type
FROM information_schema.role_routine_grants g
JOIN information_schema.routines r ON r.specific_name = g.specific_name
WHERE r.routine_name = ANY(ARRAY['함수명1', '함수명2', '...'])
ORDER BY r.routine_name, g.grantee;
```

이 함수가 회원전용(로그인 필요) RPC라면 `anon`이 결과에 나오면 안 된다. 나온다면
명시적으로 `REVOKE EXECUTE ON FUNCTION ... FROM anon;`을 추가 마이그레이션으로 적용한다.

## 절차 3 — 제약(CHECK·EXCLUDE) 대조

상태값 CHECK 제약이나 EXCLUDE 제약을 바꾸는 마이그레이션이면 양쪽에서 실제 정의를 대조한다.

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = ANY(ARRAY['제약명1', '제약명2']);
```

## 절차 4 — 마이그레이션 이력 대조

`list_migrations`(Supabase MCP)를 양쪽 project_id에 각각 호출해, **파일명이 아니라
내용으로 매칭되는 항목이 한쪽에만 있는지** 훑어본다. 특히 "번호는 다른데 같은 내용"
(예: 오늘의 #179 vs #315처럼 원본과 재적용본이 다른 번호로 존재)인 경우를 놓치기 쉬우므로,
단순 개수 비교가 아니라 최근 10~15건의 `name` 필드를 육안으로 나열해 대조한다.

---

## 절차 5 — 배포상태(코드↔DB) 교차검증

CRITICAL 마이그레이션을 동반한 기능이 git 커밋·merge로 Production에 이미 배포된
상태라면(service-operations.md §9 "배포 순서 사고" 전례), 아래도 함께 확인한다.

```
1. Vercel MCP get_git_deployment_context / get_deployment로 Production에 실제
   배포된 commit SHA를 확인한다.
2. 그 SHA 시점의 git 이력에 포함된 supabase/migrations/*.sql 파일 목록을 뽑는다
   (git show {SHA}:supabase/migrations 또는 git log --name-only).
3. 그 목록에 있는 마이그레이션이 production Supabase 프로젝트의 list_migrations
   결과에 전부 반영돼 있는지 대조한다.
4. 하나라도 코드에는 있는데 DB엔 없다면 — "코드 배포"와 "DB 마이그레이션 적용"이
   분리된 사고(§9 전례)이니 즉시 Stephen에게 보고하고 적용 여부를 확인받는다.
```

---

## 체크리스트 (복붙용)

```
[ ] 절차1: 이번 태스크가 건드린 함수 전부 stage/production 양쪽 pg_get_functiondef 비교 — 일치?
[ ] 절차2: 신규/재생성 함수의 anon 권한 상태 확인 — 회원전용인데 anon에 남아있지 않은가?
[ ] 절차3: CHECK/EXCLUDE 제약 변경이 있었다면 양쪽 정의 일치?
[ ] 절차4: list_migrations 최근 10~15건 육안 대조 — 한쪽에만 있는 항목 없는가?
[ ] 절차5: 코드가 이미 배포됐다면 배포 SHA 시점 마이그레이션 파일 = production 적용 이력?
```

---

*DRIFT_CHECK_PROCEDURE.md v1.0 | Harness Flow v3.2 | 2026-09-01 신설 —
promote_draft_reservation production 12일 누락 사고(TASK.md "🔴 실서버 전역 테스트" 항목 9)를
계기로, "CMS 전수검수"가 화면기능만 보고 DB객체 정합성은 아무도 체계적으로 확인하지
않았다는 구조적 공백을 메우기 위해 신설. sp3-qa-agent.md·sp4-deploy-agent.md에서 참조됨.*
