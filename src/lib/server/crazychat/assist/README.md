# AI 조력 생성기 (API 호출형) — 현재 비활성 보존

2026-10-08 Stephen 결정: Anthropic API를 당분간 쓰지 않는다. 삭제하지 않고 비활성으로 둔다.
(대체 경로: 지식 저장소 `../knowledge/` + 프롬프트로 직접 요청하는 오프라인 튜닝)

## 무엇이 보존되어 있나
| 구분 | 위치 | 상태 |
|---|---|---|
| 순수 로직(마스킹·검증·시뮬레이션 게이트·반영/되돌리기·파이프라인) | 이 폴더 `mask/infer/gate/apply/pipeline/collect` | **활성 코드**(테스트 38개 통과). 오프라인 도구로 재사용 가능 |
| 모델 호출부 | `model.ts` | 보존(호출되지 않음) |
| API | `src/routes/api/cms/chat/crazychat/assist/**` | 보존, **모든 핸들러가 503 반환**(`switch.ts` `ASSIST_ENABLED=false`) |
| 화면 | `src/lib/components/cms/CrazychatAssistPanel.svelte` | 보존, **어디에도 마운트하지 않음** |
| 마이그레이션 | `.claude/plan/dormant/679_ai_assist_runs.sql` | 보존, **어느 DB에도 미적용**, `supabase/migrations`에 없음 |

## 다시 켜는 순서
1. Anthropic 크레딧 충전, 외부 AI 사용 고지, 마스킹 규칙 최종 확인.
2. 마이그레이션 복원: `.claude/plan/dormant/679_ai_assist_runs.sql`을 `supabase/migrations/`로 옮기고 **다음 번호로 재부여**(그 사이 번호가 사용됨) → Stage 검증 → Production.
3. `switch.ts`의 `ASSIST_ENABLED`를 `true`로.
4. `crazychat/+page.svelte`에 `<CrazychatAssistPanel />` 마운트(휴면 컴포넌트가 상태·API 호출을 모두 가지고 있다).
5. 슈퍼마스터가 스위치(`crazychat_settings.assist_enabled`)를 켜고 Stage에서 1회 실행해 결과 확인 → 필요 시 "이번 실행 되돌리기".
6. `src/__tests__/server/crazychatAssistSwitch.test.ts`는 "비활성 상태"를 검증하므로, 켤 때 함께 갱신한다.

## 주의
즉시 운영 반영 구조다. 켜기 전에 검증 게이트와 되돌리기가 유일한 방어선임을 다시 확인할 것.
