# CMS 전역 정밀 재검증 — A5: 고객정보(customers) 트랙
날짜: 2026-09-06 | 담당 범위: `src/routes/cms/customers/**` + 관련 서버 API·컴포넌트 | 방식: 순수 읽기 전용 정적분석 + Stage DB(ezyvffjvuwmtuhpxdjrw) 함수정의·권한 직접 조회

## 요약 (3줄)
- 4개 중점사항 전부 정상 — CRITICAL 등급 결함 발견 없음. `request_account_withdrawal` RPC는 문서(§16)가 명시한 5개 상태(hold/confirmed/shipped/in_use/return_requested)를 정확히 차단하고, `/cms/customers` 목록·서브라우트 4개(membership/score/inquiry/settings) 전부 `load()` 단계에서 `hasSettingsAccess()` 게이트가 걸려 있으며, 탈회 배지 우선순위(탈회>블랙리스트>정상)도 코드와 문서가 일치한다.
- 고객정보 전용 서버 API 7종(addresses·chat-sessions·credit-audit·profile-settings·rentals·subscription-payments·subscriptions) 전부 세션체크 + `hasSettingsAccess()`(manager+) 이중 게이트가 예외 없이 적용돼 있어, 과거 이 프로젝트에서 반복됐던 "세션체크만 있고 등급체크 누락" 패턴(QR-CASE-2, updatePhone 등)이 이 트랙에는 재발하지 않았다.
- 부가발견 1건(BOUNDARY) — `CustomerDetailPanel.svelte`가 호출하는 `/api/cms/customers/[id]/inquiries`·`/coupons` 2개 엔드포인트는 `hasSettingsAccess()` 없이 "cms_role만 있으면" 통과되는데, 같은 폴더의 `summary` 엔드포인트는 명시적으로 manager+ 게이트를 걸고 있어 등급 기준이 내부적으로 일관되지 않는다(다만 이 두 엔드포인트는 `/cms/chat`(role 게이트 자체가 없는 화면)의 AdminChatPanel과 공유되는 설계로 보여 CRITICAL로 단정하지 않음, 아래 상세 참고).

## 중점사항 1 — 탈퇴 → 진행중 대여 차단 (RPC 직접 조회 완료)
Stage DB에서 `request_account_withdrawal` 함수 정의를 `pg_get_functiondef`로 직접 조회했다.

```sql
SELECT EXISTS (
  SELECT 1 FROM rental_reservations
   WHERE user_id = v_uid
     AND status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested')
) INTO v_has_active_rental;

IF v_has_active_rental THEN
  RETURN jsonb_build_object('ok', false, 'error', '진행 중인 대여를 먼저 완료해 주세요.', 'error_code', 'active_rental_exists');
END IF;
```

→ service-operations.md §16②가 명시한 5개 상태 전부 정확히 포함돼 있다. 누락 없음 — **결함 없음**.

부가 확인: 문서(§16①)가 명시한 대로 이 RPC는 `deleted_at`을 별도로 체크하지 않는다(이미 관리자가 즉시삭제한 계정의 재탈퇴 신청 경로가 열려 있음) — 이는 문서가 이미 "실무상 발생 가능성 낮아 의도적으로 미다룸"이라 기록한 기존 알려진 갭이므로 신규 발견으로 보고하지 않음.

권한 확인: `request_account_withdrawal`/`restore_withdrawn_account`는 `authenticated`+`service_role`에만 EXECUTE 권한이 있고 `anon`은 차단됨(직접 SQL 조회로 확인) — 정상.

## 중점사항 2 — CMS 고객목록 배지(withdrawal_status 우선순위)
`src/routes/cms/customers/+page.svelte` (line 259-266):
```svelte
{#if row.withdrawal_status && row.withdrawal_status !== 'none'}
  <span class="badge-withdrawn">탈회</span>
{:else if row.blacklisted}
  <span class="badge-danger">블랙리스트</span>
{:else}
  <span class="badge-normal">정상</span>
{/if}
```
→ 문서(§16⑥)가 명시한 우선순위(탈회>블랙리스트>정상)와 정확히 일치. `get_customer_list` RPC(Stage 직접 조회)도 `withdrawal_status`·`withdrawal_requested_at`·`withdrawal_purge_at`를 정상적으로 SELECT해 반환하고 있고, `WHERE deleted_at IS NULL`만 필터해 관리자 즉시삭제 계정만 제외하며 `purged` 상태 고객은 여전히 목록에 노출된다(§16①의 "CMS 목록에서 숨기지 않음" 정책과 일치) — **결함 없음**.

`CustomerDetailPanel.svelte` (line 1291-1305)의 상세 배너도 `requested`/`purged` 2분기를 정확히 구분해 신청일·삭제예정일을 표시한다.

## 중점사항 3 — role 게이트(`/cms/customers` load, manager+)
`src/routes/cms/customers/+page.server.ts` line 44-46:
```ts
const { cmsRole } = await parent()
if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')
```
→ 정상. 서브라우트 4개(`membership`·`score`·`inquiry`·`settings`)의 `load()`도 전부 동일 패턴으로 게이트돼 있음을 개별 확인 완료(4개 파일 전체 Read) — **결함 없음**. security-auth.md 매트릭스의 "고객 관리" 행 등재 내용과 일치.

## 중점사항 4 — 서버 API 7종 권한 검증 (전수 확인)
| 파일 | 세션체크 | role체크(manager+) |
|---|---|---|
| `addresses/+server.ts` | O | O (`hasSettingsAccess`) |
| `chat-sessions/+server.ts` | O | O |
| `credit-audit/+server.ts` | O | O |
| `profile-settings/+server.ts` | O | O |
| `rentals/+server.ts` | O | O |
| `subscription-payments/+server.ts` | O | O (`getCmsRoleForAction` 경유, 주석에 "형제 엔드포인트보다 한 단계 강화된 게이트"라 명시했으나 실제 로직은 동일한 `hasSettingsAccess`) |
| `subscriptions/+server.ts` | O | O |

7종 전부 세션 체크 후 `hasSettingsAccess(cmsRole)` (또는 동등한 role≥50 체크)를 통과해야만 `service_role` 클라이언트로 조회를 진행한다. Stage DB에서 관련 RPC(`get_customer_list`·`toggle_blacklist`·`adjust_credit_score`·`update_customer_info`·`soft_delete_customer` 등)의 EXECUTE 권한도 `anon=false, authenticated=false, service_role=true`로 확인해, 설령 앱 코드의 게이트를 우회해도 DB 레벨에서 이중 방어가 걸려 있음을 확인 — **결함 없음**.

`+page.server.ts`의 폼 액션 5개(`toggleBlacklist`·`cancelSubscription`·`updateCustomerInfo`·`adjustScore`·`deleteCustomer`) 전부 `session` 체크 → `getCmsRoleForAction()` → `hasSettingsAccess()`(또는 `deleteCustomer`는 `['manager','superadmin'].includes(role)`로 동등 검사) 패턴을 따름 — security-auth.md "form action에서 locals.cmsRole 직접 사용 절대 금지" 원칙도 준수(전부 `getCmsRoleForAction` 헬퍼 사용, `locals.cmsRole` 직접 참조 없음).

## 신규 발견 (등급별)

### BOUNDARY — `/api/cms/customers/[id]/inquiries`·`/coupons`에 manager+ 게이트 부재 (등급기준 내부 불일치 가능성)
- 파일: `src/routes/api/cms/customers/[id]/inquiries/+server.ts` (전체), `src/routes/api/cms/customers/[id]/coupons/+server.ts` (전체)
- 재현조건: `cms_role='partner'`인 세션으로 `GET /api/cms/customers/{user_profiles.id}/inquiries` 또는 `/coupons`를 직접 호출
- 현재 로직: `if (!cmsRole) return 401` 만 체크 — `hasSettingsAccess()` 호출 없음. 즉 partner도 통과.
- 대조: 같은 디렉토리의 `summary/+server.ts`는 `if (!hasSettingsAccess(cmsRole)) return 403`을 명시적으로 추가하며 주석으로 "크레이지스코어·블랙리스트 등 민감정보 포함 — 파트너는 조회 불가(매니저 이상만)"라고 이유까지 남겨둠 — 즉 이 파일 작성자는 등급 구분을 의식적으로 고려했는데, 같은 고객 데이터를 다루는 형제 파일(inquiries/coupons)에는 같은 고려가 적용되지 않음.
- 영향범위: `inquiries`는 고객의 CS 문의 원문(불만 내용 등 개인정보성 텍스트) + 관리자 답변 전체를 반환. `coupons`는 고객의 쿠폰 사용현황과 `redeemed_code`(실제 채번된 쿠폰코드 원문)를 반환.
- 다만 CRITICAL로 단정하지 않은 이유: 이 두 엔드포인트는 `src/lib/components/chat/AdminChatPanel.svelte`(즉 `/cms/chat` 화면)에서도 재사용되며, `/cms/chat/+page.server.ts`의 `load()`는 `hasSettingsAccess` 게이트 자체가 없어(세션만 있으면 접근 가능) 그 화면은 애초에 모든 cms_role(partner 포함)에게 열려 있는 것으로 보인다. `coupons/+server.ts`의 코드 주석("관리자 채팅 CTA 모달에서 그대로 재사용하기 위한 단건 조회")도 이 공유 설계를 뒷받침한다. 즉 partner가 "고객관리" 화면(`/cms/customers`, manager+ 전용)에는 못 들어가지만 "채팅상담" 화면(`/cms/chat`, 전체 허용)을 통해 같은 데이터에 접근하는 경로가 이미 설계상 존재할 가능성이 있어, 이 발견이 "버그"인지 "의도된 등급 차등(민감도 낮은 데이터는 partner도 채팅상담 중 열람 허용)"인지는 Stephen 확인이 필요하다.
- 권장 조치: Stephen에게 "채팅상담 중 partner가 고객의 CS문의 원문·쿠폰코드까지 볼 수 있어야 하는지"를 확인 후, 아니라면 두 엔드포인트에도 `hasSettingsAccess()`를 추가(단, 그 경우 `/cms/chat`에서 partner가 이 카드를 열람하려 할 때 403이 뜨는 UX 처리도 함께 필요).

## 부가발견
- `src/routes/cms/customers/+page.svelte`·`membership/+page.svelte`·`score/+page.svelte` 전부 `membership_grade`를 "구독상품 티어"로 정확히 취급하고 있음을 확인(고객등급으로 오인한 코드 없음) — 2026-09-01 재구성 이후 정합 유지됨. `misidentifications.md`의 "membership_grade는 구독티어" 오인 패턴이 이 트랙에서는 재발하지 않았다.
- `InquiryReplyForm.svelte`가 종결 체크박스에 표준 `<input type="checkbox">`를 사용(uiux-index.md의 CheckIcon 표준과 다른 네이티브 체크박스) — CMS 내부 관리자 전용 폼이라 사용자 노출 UI 표준(front-uiux.md 약관동의 체크아이콘) 적용 대상인지 불명확하여 ROUTINE 미만으로 판단, 별도 보고하지 않음(문서에 CMS 전용 폼의 체크박스 표준이 명시돼 있지 않음).

## 자체 오인점검
- `membership_grade`를 고객등급으로 오인하지 않았는지 각별히 확인 — 위 "부가발견" 항목에서 코드 3곳을 직접 grep해 재확인 완료, 오인 없음.
- RPC 정의·권한을 "기억"이 아니라 매 항목 Stage DB `pg_get_functiondef`/`has_function_privilege` 직접 조회로 검증(misidentifications.md의 "과거 마이그레이션 근거를 기억에 의존해 서술" 오인 패턴 회피).
- 담당 범위를 벗어난 `/api/cms/customers/[id]/*` 3개 파일(`inquiries`·`coupons`·`summary`)을 스코프 확장 없이 "읽기"만 수행(수정 없음) — CustomerDetailPanel이 직접 호출하는 파일이라 검증 필요성이 있다고 판단해 조사했으나, 이는 원 아젠다의 "7종" 목록 밖이므로 CRITICAL이 아닌 BOUNDARY로 보수적으로 등급을 매김.
