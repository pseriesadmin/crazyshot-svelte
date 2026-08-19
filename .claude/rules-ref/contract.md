# contract.md — 전자계약·서명 도메인 규칙
# Harness Flow v3.2 | 전자계약 시스템 (CMS 발송 + 고객 서명 + 채팅 연동)
# 신규 작성 2026-07-28 — 여러 문서·세션 로그에 흩어져 있던 전자계약 개발정보 통합본

---

## 핵심 원칙

```
서명 등록 = contract_signings.signed_at 원자적 UPDATE (.is('signed_at', null) 가드) — 이중서명 물리적 불가
토큰      = 256bit 랜덤 hex (gen_random_bytes(32)) — 무차별 대입 사실상 불가, URL 토큰 자체가 유일한 인증 수단
서명 유효성 = "1회 이상 등록"이 유일한 기준 (2026-07-28 확정) — 스트로크 수·드로잉 길이 등 임의 요건 추가 금지
만료 확인 = 서명 페이지 GET 로드 + 서명 제출 POST 양쪽에서 반드시 expires_at 체크
           (한쪽만 체크하면 만료 링크로 PII·계약 전문이 노출됨 — 2026-07-28 실제 발견된 결함)
계약 내용 = contracts.content_blocks에 발송 시점 변수 치환 완료본을 저장
           (고객 화면은 이 값을 그대로 렌더링 — 재치환 없음, document_url/PDF 경유 아님)
비밀키    = SUPABASE_SERVICE_ROLE_KEY $env/static/private 전용
           고객측 라우트(/contract/[token], /api/contracts/[token]/sign)도 예외 없이 service_role 사용
           (토큰 기반 익명 접근 구조상 RLS 우회가 설계상 불가피 — 신규 위험 아님)
```

---

## 시스템 아키텍처

```
[관리자 CMS]                                    [고객]
RentalContractViewer                             채팅(ChatWindow)
  │ "미리보기 & 발송" 클릭                          │ "전자계약 보기" 액션카드 클릭
  ▼                                                ▼
ContractTemplatePreviewModal              /contract/[token]  (+page.server.ts, service_role)
  │ GET contract-templates                         │ signed_at 체크 → expires_at 체크
  │ GET contract-data (변수 치환용)                  │ → viewed_at 기록 → user_profiles 조회
  │ substituteVariables()로 미리보기                 │ → content_blocks 그대로 렌더링
  ▼                                                ▼
"채팅으로 발송" 클릭                              체크박스 동의 + SignatureCanvas 서명
  │ POST init-contract (contracts INSERT)           │ (strokes >= 1이면 즉시 유효)
  │ PATCH content (치환 완료본 저장)                  ▼
  │ POST send-chat                                POST /api/contracts/[token]/sign
  │   → contract_signings 토큰 생성/재사용            │ signed_at/expires_at/stroke_count 재검증
  │   → 고객 채팅에 action_card(contract_link)        │ contract_signings.signed_at UPDATE(원자적)
  ▼                                                │ rental_reservations: shipped→in_use(조건부)
CMS 예약목록 배지                                   │ 관리자 채팅에 action_card(contract_signed)
  (customer_signed_at 갱신 확인)  ◄──────────────────┘ → /cms/rentals 또는 /cms/reservation 딥링크
```

> 별도 `signatures` 테이블 없음 — 서명 결과는 `contract_signings.signature_data`(PNG base64) +
> `stroke_count` + `ip_address` + `signed_at`으로 구성. PDF 병합 파이프라인은 미구현 상태이며
> `contracts.document_url`은 앱 전체에서 한 번도 write되지 않는 죽은 컬럼이다(§ 데이터 모델 참고).

---

## 데이터 모델

### `contracts` — 계약서 콘텐츠 원본

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | UUID | PK |
| `reservation_id` | BIGINT | FK `rental_reservations` |
| `user_id` | UUID | FK `auth.users` |
| `contract_type` | enum | `'rental'` \| `'subscription'` |
| `status` | enum | `'active'`\|`'completed'`\|`'cancelled'` — ⚠️ **사실상 죽은 필드**, 어느 화면에도 렌더링되지 않고 상태 전이를 강제하는 로직도 없음 |
| `document_url` | TEXT | ⚠️ **항상 NULL** — PDF 생성 파이프라인 자체가 미구현. 이 필드를 기다리는 UI를 짜면 무한로딩 버그가 재현된다(2026-07-28 실제 발생) |
| `signed_at` | TIMESTAMPTZ | `contracts` 자체의 signed_at — **실제 서명완료 판정에는 사용되지 않음**(§ 상태 판정 참고) |
| `template_id` | UUID | FK `contract_templates` |
| `title` | TEXT | 계약서 제목(발송 시점에 확정·저장) |
| `content_blocks` | JSONB | **변수 치환 완료된 본문**(`ContentBlock[]`) — 고객 화면이 그대로 렌더링하는 실제 원본 |
| `specifications` | JSONB | 현재 어느 화면에서도 렌더링하지 않음(사용처 미확인) |
| `signing_sent_at` | TIMESTAMPTZ | 발송 시각 |

### `contract_signings` — 서명 링크·서명 결과 추적

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | UUID | PK |
| `contract_id` | UUID | FK `contracts` |
| `user_id` | UUID | FK `auth.users` (nullable) |
| `token` | VARCHAR(64) | UNIQUE, `encode(gen_random_bytes(32),'hex')` — 서명 URL의 유일한 인증 수단 |
| `sent_at` | TIMESTAMPTZ | 발송/재발송 시각(재발송 시 갱신, **token은 재사용** — 회전 없음) |
| `viewed_at` | TIMESTAMPTZ | 최초 열람 시각 |
| `signed_at` | TIMESTAMPTZ | 서명 완료 시각 — **CMS "서명완료" 배지 판정에 실제로 쓰이는 컬럼** |
| `expires_at` | TIMESTAMPTZ | Migration #146, `DEFAULT now()+30일`, Stage·Production 양쪽 적용 완료 |
| `signature_data` | TEXT | 서명 PNG base64 |
| `stroke_count` | INT | 서명 시 펜을 뗀 횟수(참고 기록용 — 유효성 판정에는 `>=1`만 사용, § 서명 유효성 판정 정책 참고) |
| `ip_address` | TEXT | 서명 시점 클라이언트 IP |

RLS: `contract_signings`/`contracts` 모두 `is_cms_admin()` 전체 접근 + 본인(`auth.uid()=user_id`) 조회 정책이
있으나, 고객측 라우트는 비로그인 토큰 접근이 전제라 실제로는 **service_role로 RLS를 우회**해서 조회한다.

---

## 상태 판정 — 어디서 무엇을 보는가 (혼동 주의)

```
CMS "서명완료" 배지 (/cms/reservation contractBadge())  → contract_signings.signed_at
                                                          (contracts.signed_at 아님!)
CMS 편집버튼 잠금 (RentalContractViewer)                  → signingsentAt || customerSignedAt
CMS PDF 뷰어 노출 조건                                    → contractPdfUrl && customerSignedAt
                                                          (document_url이 항상 NULL이라 사실상 노출 안 됨)
고객 화면 계약 본문 노출                                  → contracts.content_blocks
                                                          (document_url·PDF 아님)
get_rental_list RPC의 customer_signed_at 별칭 소스        → cs.signed_at (LEFT JOIN contract_signings)
```

⚠️ `contracts.status`, `contracts.document_url`, `contracts.signed_at` 세 컬럼은 이름은 그럴듯하지만
실제 판정 로직에서 쓰이지 않거나 항상 NULL인 죽은 필드다. **진실의 원천은 `contract_signings.signed_at`
(서명 여부)과 `contracts.content_blocks`(계약 내용)** 두 가지뿐이라고 기억할 것.

---

## API 레퍼런스

### 관리자측 (CMS, 세션 인증 — `getCmsRoleForAction`)

| Method | Path | 역할 |
|---|---|---|
| GET | `/api/cms/contract-templates` | 활성 양식 목록 |
| GET | `/api/cms/reservations/[id]/contract-data` | 변수 치환용 데이터 조회(고객명·연락처·예약코드 등) |
| POST | `/api/cms/reservations/[id]/init-contract` | `contracts` INSERT(idempotent — 기존 있으면 재사용) |
| PATCH | `/api/cms/contracts/[id]/content` | `title`/`content_blocks`/`specifications`/`template_id` 저장 |
| POST | `/api/cms/contracts/[id]/send-chat` | `contract_signings` 토큰 생성/재사용 + 고객 채팅 발송 |

### 고객측 (토큰 기반, 비로그인 가능, `service_role`)

| Method | Path | 역할 |
|---|---|---|
| GET | `/contract/[token]` | 계약 확인 화면 — `signed_at`/`expires_at` 체크 후 렌더 |
| POST | `/api/contracts/[token]/sign` | 서명 등록 — `signed_at`/`expires_at`/`stroke_count` 서버 재검증 |

---

## 권한 계정별 흐름 전역 감사 (작성→발행→발송→서명→확인) — 2026-08-11

> CMS 역할 체계는 `security-auth.md`의 `ROLE_LEVEL`(superadmin:100 / manager:50 / partner:10) 기준.
> 아래는 전자계약 5단계 전 구간을 실제 코드(각 API·액션의 권한 체크 코드)로 전수 확인한 결과다.

### 단계별 권한 게이트 실측표

| 단계 | 액션 | 라우트/파일 | 실제 게이트 코드 | 통과 가능한 역할 |
|---|---|---|---|---|
| **작성** | 계약서 양식 생성 | `/cms/reservation/contracts` `create` action | `getCmsRoleForAction()` (세션만) | partner·manager·superadmin **전부** |
| **작성** | 계약서 양식 수정 | 〃 `update` action | 〃 | 전부 |
| **작성** | 계약서 양식 삭제 | 〃 `softDelete` action | 〃 | 전부 |
| **작성** | 양식 목록·상세 조회 | 〃 `load()` | `if (!cmsRole)`만 (라우트 자체 role-min 없음) | 전부 |
| **발행** | 계약 인스턴스 최초 생성 | `POST /api/cms/reservations/[id]/init-contract` | `getCmsRoleForAction()` | 전부 |
| **발행** | 계약 내용 조회·저장 | `GET/PATCH /api/cms/contracts/[id]/content` | `getCmsRoleForAction()` | 전부 |
| **발행** | 변수 치환용 데이터 조회 | `GET /api/cms/reservations/[id]/contract-data` | `getCmsRoleForAction()` | 전부 |
| **발송** | 채팅 발송(서명 링크 생성) | `POST /api/cms/contracts/[id]/send-chat` | `getCmsRoleForAction()` | 전부 |
| **서명** | 고객 서명 등록 | `GET/POST /contract/[token]`, `/api/contracts/[token]/sign` | CMS role과 무관 — **토큰 자체**가 유일한 인증(§ 핵심 원칙) | 고객(비로그인 가능) |
| **확인** | 예약목록·대여현황 배지 조회 | `/cms/reservation`, `/cms/rentals` | `if (!cmsRole)`만 | 전부 |
| **확인** | 계약서 탭 뷰어 열람 | `RentalContractViewer.svelte`(패널 내) | 클라이언트 role 분기 코드 없음 — 상위 페이지 게이트 상속 | 전부 |

`getCmsRoleForAction()`은 "유효한 CMS 계정인가"만 확인하고 역할 등급을 구분하지 않는다(§ 데이터 모델
아래 코드 참고). 등급을 실제로 구분하는 함수는 `hasSettingsAccess()`(manager 이상)인데, **전자계약
관련 11개 액션·라우트 어디에도 이 함수가 쓰이지 않는다** — `security-auth.md` 매트릭스의
"계약서 양식 | `/cms/reservation/contracts` | ✅ 세션만 | ✅ | ✅" 행과 정확히 일치하는 현재 상태.

```ts
// getCmsRoleForAction — src/lib/server/getCmsRoleForAction.ts
// "유효한 cms_role이 있는가"만 확인, 등급(partner/manager/superadmin) 구분 없음
export async function getCmsRoleForAction(locals): Promise<string | null> { ... }

// hasSettingsAccess — src/lib/utils/cmsPermissions.ts
// 실제 등급 구분 함수. manager(50) 이상만 true.
export function hasSettingsAccess(role: string): boolean {
  return getRoleLevel(role) >= getRoleLevel('manager')
}
```

### DB 레이어(RLS)도 동일하게 무차별

```
contracts / contract_signings RLS: USING (is_cms_admin())
  → is_cms_admin()는 "user_profiles.cms_role IS NOT NULL"만 확인 — 등급 무관, partner도 통과

contract_templates RLS: USING (auth.jwt() ->> 'role' = 'service_role')
  → 브라우저 클라이언트는 등급과 무관하게 아예 직접 접근 불가(서버 service_role 경유만 허용).
    즉 이 테이블의 실질적인 쓰기 권한 게이트는 100% 애플리케이션 레이어(getCmsRoleForAction)에만
    있고, 그 게이트가 위 표대로 "역할 무관 전체 허용"이다.
```

### 데이터 스코핑도 없음

`get_rental_list` RPC와 계약 관련 API 전체를 확인한 결과, **partner 계정을 자신이 담당하는
상품·예약으로 제한하는 스코핑 로직이 전자계약 도메인 어디에도 없다** — partner 계정도 플랫폼
전체 고객의 예약·PII·계약 내용을 조회·발송·편집할 수 있다.

### 🔴 정책 재검토 — 게이트 적용 확정 (Stephen 최종 결정, 2026-08-11)

```
2026-08-11 같은 날 앞선 세션에서는 위 감사 결과를 두고 Stephen이 "role 무차별 허용은 의도된
설계이며 코드 변경이 불필요하다"고 확인한 바 있었다(구버전 절 제목: "정책 확인 완료 —
QR-CASE-2와 달리 의도된 설계"). 그 결론은 이후 진행된 별도 세션(전자계약 서식 작성 에디터
고도화 플래닝, 같은 날)에서 Stephen이 최종적으로 뒤집었다.

Stephen 최종 결정(2026-08-11, 전자계약 에디터 고도화 플래닝 세션):
  → 계약서 양식 작성·수정·삭제 + 계약 발행·발송을 포함한 위 11개 액션 전부에
    hasSettingsAccess()(manager 이상) 게이트를 적용한다. QR-CASE-2(/cms/codes 19개 액션)와
    동일한 패턴으로 통일한다.

✅ 코드 적용 완료 (2026-08-11, Phase 7 — P7-1~P7-6):
  1. 5개 파일·11개 액션 전부에 hasSettingsAccess() 게이트 적용 완료
     - `/cms/reservation/contracts` load(): hasSettingsAccess false → redirect(303, '/cms?notice=access_denied')
     - `/cms/reservation/contracts` create/update/softDelete: getCmsRoleForAction + hasSettingsAccess false → fail(403)
     - `/api/cms/reservations/[id]/init-contract` POST: hasSettingsAccess false → json(403)
     - `/api/cms/reservations/[id]/contract-data` GET: hasSettingsAccess false → json(403)
     - `/api/cms/contracts/[id]/content` GET/PATCH: hasSettingsAccess false → json(403)
     - `/api/cms/contracts/[id]/send-chat` POST: hasSettingsAccess false → json(403)
  2. security-auth.md 역할별 CMS 접근 매트릭스에 "계약서 양식·발행·발송" 행 추가 완료(P7-6)
  3. GATE C 체크리스트 문구는 적용 확정 기준으로 이미 아래에 반영됨

⛔ 이 결정은 위 2026-08-11 앞선 세션의 "정책 확인 완료" 결론을 대체한다 — 과거 절 제목·문구를
참고 자료로 다시 인용하지 말 것(이미 뒤집힌 결정).
```

---

## 발송 흐름 (관리자 → 고객)

```
1. [CMS] "미리보기 & 발송" 클릭 → ContractTemplatePreviewModal 오픈
   → GET contract-templates + GET contract-data 병렬 로드
   → contractId가 있으면 GET /api/cms/contracts/{id}/content 도 로드 (편집 내용 감지)

2. [ContractTemplatePreviewModal] 발송 모드 결정 (2026-08-13 수정)
   ┌─ existing 모드 (기본값, content_blocks 비어있지 않은 경우)
   │   → 미리보기: DB에 저장된 content_blocks 그대로 표시 ("현재 편집된 내용 미리보기")
   │   → "채팅으로 발송" 클릭 → PATCH 없이 POST send-chat만 호출 (편집 내용 보존)
   │
   ├─ template 모드 (content_blocks가 비어있거나, 관리자가 덮어쓰기 명시 확인 후)
   │   → substituteVariables()로 {{변수명}} → 실데이터 치환 후 미리보기 렌더링
   │   → "채팅으로 발송" 클릭
   │       → contractId null이면 POST init-contract → { contractId }
   │       → PATCH content — { title, content_blocks(치환 완료본), specifications, template_id }
   │       → POST send-chat
   │
   └─ 덮어쓰기 확인 절차 (existing 모드에서 양식 클릭 시)
       → overwriteWarning 배너 표시: "이미 편집된 내용이 있습니다..."
       → "취소" → existing 모드 유지
       → "양식 다시 적용" → template 모드 전환 → 미리보기 갱신

3. POST send-chat (existing / template 모드 공통)
   → contract_signings: 기존 있으면 재사용(sent_at만 갱신) / 없으면 신규 INSERT
   → 세션 우선순위: pending → open → closed(재활성화) → 신규 생성
   → chat_messages INSERT: action_payload { type:'contract_link', action_url: '/contract/{token}' }
   → 성공: 배너 "계약서 발송됨 · 서명 대기 중" 전환
```

⚠️ **발송 모드 불변식 (2026-08-13 수정, QA 3차 재검수 발견)**
```
existing 모드에서 "채팅으로 발송" → PATCH /api/cms/contracts/{id}/content 절대 호출 안 됨
  → applyContractTemplate()을 호출하지 않으므로 기존 content_blocks가 그대로 보존됨
  → 관리자가 "편집"에서 수동으로 고친 내용이 발송 시 조용히 사라지는 버그 해소

template 모드 전환 = 반드시 명시적인 "양식 다시 적용" 확인 클릭 경유
  → 조용히 덮어쓰는 경로 없음 (과거 버그: 발송 클릭만으로 항상 template 원본으로 덮어썼음)
```

유틸리티: `src/lib/utils/contract-content-mode.ts` — `hasExistingContractContent(blocks)` 함수

### 계약서 양식 편집 제한 정책

```
편집(btn-tpl-edit) 표시 조건: signingsentAt = null AND customerSignedAt = null
  → 계약서가 한 번도 발송되지 않은 경우에만 편집 허용
편집 숨김 조건(둘 중 하나): ① signingsentAt 있음(발송 이후) ② customerSignedAt 있음(서명 완료 이후)
미리보기 & 발송 버튼: 모든 상태에서 항상 표시(재발송 용도)
PDF 뷰어·다운로드: contractPdfUrl && customerSignedAt → 표시(현재는 document_url이 항상 NULL이라 사실상 비노출)
서명 링크 확인 ↗: signingUrl && !customerSignedAt → 표시(서명 완료 후 자동 숨김)
```

구현 파일: `src/lib/components/cms/RentalContractViewer.svelte`

---

## 서명 흐름 (고객 → 관리자 피드백까지)

```
1. 고객이 채팅 action_card("전자계약 보기") 클릭 → /contract/{token}

2. GET load() 실행 순서 (이 순서가 보안상 중요 — § 만료 링크 처리 참고)
   ① contract_signings + contracts + rental_reservations 단일 SELECT
   ② signed_at 있음 → redirect('/contract/signed')
   ③ expires_at < now() → redirect('/contract/expired')   ← PII 조회 이전에 실행 중단
   ④ viewed_at 최초 기록
   ⑤ rental_reservations.user_id로 user_profiles(이름·전화번호·이메일) 조회
   ⑥ return { signing, customer } — content_blocks 그대로 렌더링

3. 고객이 체크박스 동의 + SignatureCanvas 서명(1회 이상) → "서명하기" 버튼 활성화
   → POST /api/contracts/[token]/sign { signature_data, stroke_count }

4. 서버 처리
   ① signed_at/expires_at/stroke_count 재검증(클라이언트 우회 방어)
   ② contract_signings UPDATE(signed_at/ip_address/signature_data/stroke_count)
      — .is('signed_at', null) 가드로 원자적 1회성 보장
   ③ rental_reservations: 현재 status가 'shipped'였다면 'in_use'로 UPDATE(조건부, await 먼저 완료)
   ④ 갱신된 rental_reservations.status를 다시 SELECT → RENTAL_STATUSES 판정(§ 딥링크 라우팅)
   ⑤ 관리자 채팅에 action_card 삽입: "OOO 고객님의 전자계약 서명이 완료되었습니다"
      action_payload { type:'contract_signed', reservation_no, action_url: '{cmsPath}?selected={reservation_id}' }
   ⑥ done=true → 1.2초 후 /contract/complete로 이동
```

---

## 관리자 딥링크 라우팅 (2026-07-28 확정)

```
서명완료 알림 action_url 분기:
  예약 현재 상태가 RENTAL_STATUSES
    (confirmed/shipped/in_use/return_requested/returned/completed/damage_claimed)
    → /cms/rentals?selected={reservation_id}
  그 외(hold/pending/cancelled)
    → /cms/reservation?selected={reservation_id}
  (rental-lifecycle.md "/cms/rentals 필터 정책"의 상태 분류와 완전히 동일한 기준)

⚠️ 판정 시점 주의: rental_reservations 상태 UPDATE(shipped→in_use)를 반드시 먼저 단독 await한
   뒤에 상태를 SELECT할 것 — 동시 실행(Promise.all)하면 갱신 전 상태를 읽는 레이스 컨디션 발생

/cms/reservation·/cms/rentals 공통: 마운트 시 data.selectedId(서버가 URL의 ?selected= 파싱)로
  selectedId를 1회 초기화 → 해당 예약 패널 자동 오픈
  (풀 네비게이션으로 진입할 때만 적용되는 패턴 — 이후 선택/해제는 openPanel()/closePanel()이
   직접 제어하며 별도 재동기화 effect는 의도적으로 추가하지 않음. core-rules.md의 "$state(prop)
   초기화 금지" 규칙과 다른 케이스: 재마운트 없는 prop 변경이 아니라 최초 마운트 1회 반영이므로 위반 아님)
```

⚠️ **한계**: 대상 예약이 관리자가 보고 있는 현재 필터·페이지네이션(30건/페이지) 밖에 있으면
`data.rentals`에서 못 찾아 URL은 정확히 이동해도 패널이 자동으로 열리지 않는다. id 단건 조회로
페이지네이션과 무관하게 항상 열리게 하려면 별도 설계가 필요(2026-07-28 기준 미구현, 필요 시 별도 확인 후 진행).

---

## 서명 유효성 판정 정책 (2026-07-28 최종 확정 — 임의로 되돌리지 말 것)

```
⛔ 과거 이력(둘 다 폐기됨):
  ① minStrokes=3 (펜을 뗀 횟수 3회 이상 요구)
     → 법적 근거 없음. 실제 서명은 대부분 펜을 떼지 않는 1획 필기체라 정상 서명해도
       영구적으로 조건 미충족 → 서명 버튼이 절대 활성화되지 않는 CRITICAL 버그였음
  ② minLength=40px (누적 드로잉 길이 요구) — ①을 대체하며 도입
     → 이 역시 Stephen 확인 없이 임의로 추가한 기준으로, 마찬가지로 법적 근거 없음

✅ 최종 확정: strokes >= 1 (1회라도 그리면 즉시 유효) 단일 기준
  - 클라이언트(SignatureCanvas.svelte)·서버(sign/+server.ts) 양쪽이 반드시 동일 기준 유지
  - 근거: 전자서명법상 스트로크 수·드로잉 길이 요구사항 없음. 서명의 증빙력은
    이미지 데이터(signature_data) + IP + timestamp 기록으로 이미 확보됨 — 추가 임의 요건 불필요

⛔ 향후 이 기준을 다시 강화(스트로크 수·길이 등)하려는 제안이 나오면, 반드시 Stephen에게
   법적·정책적 근거를 먼저 확인할 것 — 같은 실수(임의 기준 추가)가 이미 두 번 반복된 이력이 있다.
```

구현 파일: `src/lib/components/common/SignatureCanvas.svelte`(클라이언트 판정),
`src/routes/api/contracts/[token]/sign/+server.ts`(서버 재검증)

---

## 만료 링크 처리 (2026-07-28 수정 — PII 노출 결함 해소)

```
⛔ 과거 버그: expires_at 컬럼(Migration #146)이 Stage·Production DB 양쪽에 이미 존재했음에도
   GET /contract/[token] 로드가 이 값을 전혀 체크하지 않았음 → 만료된 링크로 접속해도
   예약자 PII(이름·전화번호·이메일)와 계약 전문이 그대로 노출되고, 서명 제출(POST) 시점에서만
   410 에러로 막혔음(체크박스+서명까지 다 입력한 뒤에야 거부되는 나쁜 UX이기도 했음)

✅ 현재: GET 로드 단계에서 signed_at 체크 직후 expires_at 체크 → 만료 시 /contract/expired로
   즉시 redirect(throw redirect) — 이후 단계(viewed_at 기록, user_profiles PII 조회, 직렬화)가
   아예 실행되지 않으므로 근본적으로 차단됨

원칙: 만료·서명완료 등 "접근 자체를 막아야 하는" 조건은 반드시 PII를 조회하기 이전 단계에서
   체크하고 즉시 redirect할 것 — 체크 따로, PII 조회 따로 흩어놓지 말 것
```

---

## 채팅 연동 — action_payload 타입

| type | 발생 시점 | action_url | 발신자 |
|---|---|---|---|
| `contract_link` | 관리자 발송(`send-chat`) | `/contract/{token}` (고객용, 실제 서명 화면 딥링크) | admin |
| `contract_signed` | 고객 서명 완료(`sign`) | `/account/rental/{reservation_id}/contract` (고객용, 아래 "고객용 서명완료 계약서 열람" 절) | admin(시스템 대리 발신) |

렌더링 컴포넌트: `src/lib/components/chat/ActionCard.svelte` (고객·관리자 채팅 공용, `MessageBubble.svelte` 경유)

> ⚠️ `chat.md`의 전체 파이프라인 다이어그램에는 "계약" 단계가 이름만 언급되어 있고 이 표의
> 상세 내용은 없다 — 채팅 시스템 관련 작업 시에도 계약 관련 action_payload를 건드린다면 이 문서를 참조할 것.

✅ **`contract_signed` action_url 미정합 — 해결 완료(2026-08-19 발견 → 같은 날 수정)**: 이
카드는 관리자용이 아니라 **고객 본인의 채팅 세션**(`find_or_create_general_chat_session
(p_user_id=서명자)`)에 삽입된다 — 위 표의 "관리자용" 서술은 과거 설계 의도만 남은 것이고
실제로는 고객이 보는 카드였다. 발견 당시 action_url이 `{cmsPath}`(CMS 전용, `cms_role` 없는
고객은 `/cms/login`으로 튕겨나감) → 그 후 다른 세션이 `/account/rental/{reservation_id}`로
바꿨으나 그 경로엔 `+page.svelte` 자체가 없어 여전히 404 → 아래 "고객용 서명완료 계약서
열람" 절에서 신설한 실제 뷰어 라우트(`/account/rental/{id}/contract`)로 최종 정정해
`src/routes/api/contracts/[token]/sign/+server.ts`의 `action_url`을 맞췄다. 이제 고객이
채팅카드를 클릭하면 실제로 서명본을 볼 수 있다.

---

## 고객용 서명완료 계약서 열람 (2026-08-19 신규)

```
Stephen 요청: "/account/rental 목록 카드에 '전자계약 확인' 버튼 배치 → 새창 뷰어로 확인"

라우트: /account/rental/[id]/contract (GET, 새 창으로 오픈)
  - src/routes/account/rental/[id]/contract/+page.server.ts
  - src/routes/account/rental/[id]/contract/+page.svelte

/contract/[token](1회성 토큰 서명화면)과 다른 점:
  - 토큰이 아니라 로그인 세션 기반 — 예약 소유권을 locals.supabase(RLS, auth.uid()=user_id)로
    먼저 확인한 뒤에만 admin(service_role) 클라이언트로 contracts/contract_signings 조회
  - 서명 폼(SignatureCanvas·동의 체크박스)이 전혀 없음 — 순수 읽기 전용
  - 서명 필드(canvas 모드) 또는 별도 "서명 완료" 섹션(flow/spreadsheet 모드)에 서명 당시
    캡처된 signature_data(base64 PNG)를 <img>로 표시 + 서명 시각
  - 상단에 "인쇄하기" 버튼(window.print()) — 기존 @page A4 프린트 스타일 재사용

DOM 구조·CSS는 /contract/[token]/+page.svelte와 동일하게 유지(.contract-main > .doc-section
> .doc-block-tiptap 패딩 체인) — canvas 모드 필드 좌표가 이 패딩 체인을 기준으로 저장되므로
구조가 달라지면 겹치기(overlay) 이미지 위치가 틀어진다(ui-mobile.md 좌표계 원점 결함 사례 참고).
기존 서명화면 파일은 건드리지 않고 새 파일에 동일 구조를 복제하는 방식으로 안전하게 재사용.

/account/rental 목록(+page.server.ts)에 has_signed_contract 판정 추가 — contracts를
contract_signings!inner로 조인해 signed_at IS NOT NULL인 예약 id만 Set으로 모아 카드에
"전자계약 확인" 버튼(있으면)만 노출. 카드에 계약이 여러 건(재발송 등)이어도 signed 여부만
확인하고, 뷰어 쪽에서는 가장 최근 서명(signed_at DESC LIMIT 1)만 보여준다.
```

→ 감사로그: `recordAuditLog(..., eventType:'viewed', actorType:'customer')` — /contract/[token]의
viewed 기록과 동일 관례로 고객 본인의 재열람도 append-only로 남긴다.

---

## 변수 치환 시스템

```
저장: DB(contracts.content_blocks)에는 발송 시점에 이미 변수 치환이 완료된 값만 저장(원본 {{}}는 보존 안 됨)
      단, 발송 전 편집 단계(양식 원본, contract_templates)에는 {{변수명}}이 그대로 남아있음
치환 시점: ContractTemplatePreviewModal.send() 호출 시 substituteVariables()로 1회 치환 후 PATCH 저장
      → 이후 고객 화면(/contract/[token])은 이 저장된 값을 재치환 없이 그대로 렌더링

유틸: src/lib/utils/contract-substitution.ts
타입: src/lib/types/contract-module.ts (ContractSubstitutionData)
```

| 변수 | 소스 |
|---|---|
| `{{고객이름}}` | `user_profiles.full_name` |
| `{{연락처}}` | `user_profiles.phone` |
| `{{이메일}}` | `user_profiles.email` |
| `{{주소}}` | `user_shipping_addresses` (is_default=true) |
| `{{예약코드}}` | `rental_reservations.reservation_code` |
| `{{상품명}}` | `products.name` |
| `{{상품코드}}` | `products.product_code` |
| `{{수령형태}}` / `{{수령일시}}` | pickup_method(레이블 치환) / pickup_time |
| `{{반납형태}}` / `{{반납일시}}` | return_method(레이블 치환) / return_time |
| `{{기본대여요금}}` | `orders.total_amount` |
| `{{할인금액}}` | `orders.discount_amount` (쿠폰+포인트 통합) |
| `{{부가세}}` | `orders.tax_amount` |
| `{{최종합계}}` | `orders.final_amount` |

---

## 고객 서명 화면 UI 확정 사항 (2026-07-28)

```
타이틀: "크레이지샷 상품대여 전자계약서" (구 "전자 대여 계약서"에서 변경)
헤더 노출: 예약코드 · 예약자 이름 · 전화번호 · 이메일 (contract.server.ts에서 user_profiles 별도 조회)
계약 본문: contracts.content_blocks를 CMS ContractTemplatePreviewModal과 동일한 렌더링 패턴으로 표시
  (text/html/divider 블록 타입 분기, {@html} 사용 — content_blocks는 CMS 관리자만 작성 가능해
   고객 입력 경로가 없으므로 기존 CMS 신뢰 경계를 고객 화면까지 그대로 연장한 것)
서명 힌트: "여기에 서명하세요" / "서명 완료" 2단계만 (스트로크 카운트 문구·서명 가이드 문구 제거)
```

구현 파일: `src/routes/contract/[token]/+page.svelte`, `+page.server.ts`

---

## 주요 파일 인덱스

| 역할 | 파일 |
|---|---|
| 관리자 미리보기·발송 모달 | `src/lib/components/cms/ContractTemplatePreviewModal.svelte` |
| 관리자 계약서 탭 뷰어 | `src/lib/components/cms/RentalContractViewer.svelte` |
| 관리자 계약서 양식 에디터 | `src/lib/components/cms/ContractEditorModal.svelte`, `ContractTemplatePanel.svelte`, `ContractModuleBar.svelte` |
| 고객 서명 화면 | `src/routes/contract/[token]/+page.svelte`, `+page.server.ts` |
| 고객 서명 캔버스(공용 컴포넌트) | `src/lib/components/common/SignatureCanvas.svelte` |
| 서명 완료/만료 안내 페이지 | `src/routes/contract/complete/`, `signed/`, `expired/` |
| 계약서 즉시 생성 API | `src/routes/api/cms/reservations/[id]/init-contract/+server.ts` |
| 변수 치환 데이터 조회 API | `src/routes/api/cms/reservations/[id]/contract-data/+server.ts` |
| 계약서 양식 목록 API | `src/routes/api/cms/contract-templates/+server.ts` |
| 계약서 내용 저장 API | `src/routes/api/cms/contracts/[id]/content/+server.ts` |
| 채팅 발송 API | `src/routes/api/cms/contracts/[id]/send-chat/+server.ts` |
| 고객 서명 등록 API | `src/routes/api/contracts/[token]/sign/+server.ts` |
| 변수 치환 유틸 | `src/lib/utils/contract-substitution.ts` |
| 타입 정의 | `src/lib/types/contract-module.ts`, `contract-template.ts` |
| CMS 예약목록(서명 배지) | `src/routes/cms/reservation/+page.svelte`, `+page.server.ts` (`get_rental_list` RPC) |
| CMS 대여현황(딥링크 대상) | `src/routes/cms/rentals/+page.svelte`, `+page.server.ts` |
| 만료 컬럼 마이그레이션 | `supabase/migrations/20260723000146_146_contract_signings_expiry.sql` |
| 콘텐츠 필드 마이그레이션 | `supabase/migrations/20260723000149_149_contracts_content_fields.sql` |

---

## GATE C 확인 항목 (전자계약 관련)

```
[ ] contracts.document_url을 기다리는 UI를 새로 만들지 않았는가? (항상 NULL — content_blocks 사용)
[ ] 서명완료 판정에 contract_signings.signed_at을 사용하는가? (contracts.signed_at 아님)
[ ] 고객측 라우트(/contract/[token], /api/contracts/[token]/*)가 GET·POST 양쪽에서
    expires_at을 체크하는가? (한쪽만 체크하면 PII 노출 재발)
[ ] 만료·서명완료 등 접근 차단 조건이 PII 조회 이전 단계에서 체크되는가?
[ ] 서명 유효성 판정이 strokes>=1 단일 기준을 유지하는가? (스트로크 수·길이 등 임의 요건 재도입 금지)
[ ] 클라이언트(SignatureCanvas)와 서버(sign/+server.ts)의 서명 유효성 기준이 동일한가?
[ ] 관리자 서명완료 알림 action_url이 예약 현재 상태 기준으로 /cms/rentals·/cms/reservation을
    정확히 분기하는가? (RENTAL_STATUSES 판정 — rental-lifecycle.md와 동일 기준)
[ ] 예약 상태 UPDATE와 그 결과를 읽는 SELECT 순서가 올바른가? (UPDATE 먼저 단독 await)
[ ] {@html} content_blocks 렌더링 — content_blocks는 CMS 관리자만 작성 가능한 경로인가?
    (고객 입력이 섞여 들어갈 수 있는 구조로 바뀌면 XSS 위험 재평가 필요)
[ ] SUPABASE_SERVICE_ROLE_KEY가 $env/static/private에서만 import되는가?
[ ] 계약서 편집 버튼: signingsentAt 또는 customerSignedAt 있으면 숨김?
[ ] 계약서 미리보기 & 발송 버튼: 모든 상태에서 항상 표시?
[ ] ✅ existing 모드에서 "채팅으로 발송" 클릭 시 PATCH /api/cms/contracts/{id}/content 호출 안 됨?
    (applyContractTemplate() 미호출 = 편집 내용 보존 보장 — 2026-08-13 워크플로우 버그 수정)
[ ] ✅ existing 모드에서 양식 클릭 시 즉시 overwrite하지 않고 overwriteWarning 배너를 먼저 표시?
[ ] ✅ "양식 다시 적용" 명시 확인 후에만 template 모드로 전환되는가?
[ ] ✅ 신규 계약(content_blocks 비어있음) → template 모드 기본값 유지 (기존 동작)?
[ ] PDF 뷰어·다운로드: customerSignedAt 없으면 숨김?
[ ] 서명 링크 확인 ↗: customerSignedAt 있으면 숨김?
[ ] ✅ 신규·기존 계약 관련 CMS 액션(양식 작성/수정/삭제, 계약 발행, 내용 편집, 채팅 발송) 5개
    파일·11개 액션 전부에 getCmsRoleForAction() + hasSettingsAccess()(manager 이상) 이중 게이트
    적용됐는가? (P7-1~P7-5 완료 — 2026-08-11, 파트너 계정으로 403/redirect 확인됨)
[ ] ✅ load() 진입 게이트(/cms/reservation/contracts)가 hasSettingsAccess() 기준으로 partner
    접근을 redirect(303, '/cms?notice=access_denied')로 차단하는가? (P7-1 완료)
[ ] (P8A) content_hash가 서명 제출 시점 최종 content_blocks/canvas_document의 SHA-256과
    일치하는가? (P8A-1 구현 후 활성화)
[ ] (P8A) contract_audit_log에 viewed/signed/sent/issuer_signed 이벤트가 순서대로 기록되는가?
    (P8A-3 구현 후 활성화)
[ ] (P8B) 발행자 서명 필수 플래그가 켜진 양식은 서명 없이 발송 시도 시 서버에서 차단되는가?
    (P8B-4 구현 후 활성화)
```

---

*contract.md v1.4 | Harness Flow v3.2 | 2026-07-28 신규 작성 — rental-lifecycle.md·TASK.md 세션 로그·
코드 직접 조사로 흩어져 있던 전자계약(CMS 발송 + 고객 서명 + 채팅 연동 + 보안) 개발정보 통합 |
2026-08-11 권한 계정별 흐름(작성→발행→발송→서명→확인) 전역 감사 추가 — 앞선 세션에서는 Stephen이
role 무차별 허용을 의도된 설계로 확인했으나(구v1.2), 같은 날 이어진 전자계약 에디터 고도화
플래닝 세션에서 이 결론을 뒤집고 11개 액션 전부에 manager 이상 게이트 적용을 최종 확정 |
2026-08-13 발송 흐름 §업데이트 — QA 3차 재검수 발견 워크플로우 버그 수정:
  "미리보기 & 발송"이 기존 편집 내용을 무시하고 템플릿 원본으로 덮어쓰는 버그 해소.
  ContractTemplatePreviewModal에 existing/template 모드 분기 도입 —
  기존 content_blocks가 있으면 existing 모드(PATCH 없이 send-chat만), 명시적 확인 후에만
  template 모드 전환. 관련 유틸: src/lib/utils/contract-content-mode.ts |
  TDD: src/__tests__/services/contractContentMode.test.ts (14개 케이스)*
*2026-08-19 고객용 서명완료 계약서 열람 신규(Stephen 요청) — /account/rental/[id]/contract
라우트 신설(로그인 세션 기반 읽기전용 뷰어, /contract/[token]과 동일 DOM/CSS 구조 재사용) +
목록 카드 "전자계약 확인" 버튼(새 창) + `contract_signed` action_url이 실제로는 고객 세션에
꽂히는데도 CMS 전용 경로라 접근 불가했던 미정합 발견·문서화(수정은 다른 세션이 이미
손대고 있던 파일이라 이번 범위에서 보류).*
