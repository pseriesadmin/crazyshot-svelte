# nlsearch.md — 자연어검색엔진(NLSearch) 모듈 정본
# Harness Flow v3.2 | 2026-08-06 신설

---

## 이 문서를 언제 부르나

```
"NLSearch" / "자연어검색엔진" / "자연어검색" / "동의어학습" 언급 시 즉시 이 문서 호출.
상품검색(/products/search)·CMS 상담채팅 자동매칭(/cms/chat) 관련 작업 시에도 호출 대상.
```

> 공식 명칭: **NLSearch (자연어검색엔진)** — 상품검색 + 상담채팅 자동매칭 + 동의어 자동학습을
> 아우르는 검색/매칭 모듈 패키지 전체를 가리키는 이름. 2026-08-06 세션에서 신설, Stephen 확정.

---

## 1. 전체 구조

```
src/lib/server/searchEngine/
  core/                     ← crazyshot 전용 코드 0% — 순수 TS + minisearch 패키지만 (이식 가능)
    types.ts                  NaturalSearchProvider 인터페이스, SearchDocument/SearchOptions/SearchResult
    koreanTokenizer.ts        한국어 조사 제거 + 초성 변환 순수 함수
    miniSearchProvider.ts     MiniSearch를 NaturalSearchProvider로 감싼 구현체 (현재 유일한 구현체)
    createIndex.ts            제네릭 인덱스 팩토리
    crossLingualPatternExtractor.ts  이중언어 괄호패턴 추출 순수함수 (§B-1, 2026-08-15)
                                      extractBilingualPairs(text) → {hangul, latin}[]
    synonymExpander.ts        동의어 확장 순수함수 (§E-1, 2026-08-15)
                                      expandQueryWithConfirmedSynonyms(query, groups) → string[]
    index.ts                  공개 export barrel — 이 폴더 전체가 이식/패키징 단위

  adapters/                 ← crazyshot DB 스키마를 core가 이해하는 문서 포맷으로 변환하는 접착 코드
    productSearchIndex.ts     상품 검색 인덱스 (부모 상품만, TTL 60초 캐시, invalidateProductSearchCache())
                              H-1(2026-08-07): components·specifications JSONB 색인 추가 (boost=3)
                              J-2(2026-08-07): product_search_stats 학습 기반 키워드 자동승격
                              extractContentBlocksText() — export됨 (crazylogSearchIndex가 재사용)
                              extractJsonbKeyValues() — export됨 (JSONB key-value 텍스트 추출 공유)
    cannedResponseSearchIndex.ts  빠른답변 검색 인덱스 (TTL 60초 캐시, invalidateCannedResponseIndex())
    crazylogSearchIndex.ts    크레이지로그 검색 인덱스 (2026-08-07 신설, §I)
                              user_posts(published+is_public=true), TTL 60초 캐시
                              getCrazylogSearchIndex() / invalidateCrazylogSearchCache()

src/lib/server/matchCannedResponse.ts   ← 상담채팅 자동매칭 순수함수 (calls core+adapters)
src/lib/server/synonymLearning.ts       ← 동의어 자동학습 (calls DB RPC + core/koreanTokenizer)
```

**설계 원칙(변경 금지)**: `core/`는 Supabase 클라이언트·`$env/*`·SvelteKit 타입 등 crazyshot 전용
import를 절대 포함하지 않는다 — 다른 협력 프로젝트로 폴더째 복사하거나 향후 별도 npm 패키지로
추출 가능한 상태를 유지해야 한다. crazyshot 전용 로직(DB 조회 등)은 반드시 `adapters/`에만 작성.

---

## 2. 상품검색 연동 (`/products/search`)

```
클라이언트: src/routes/products/search/+page.svelte
  → doSearch()가 fetch('/api/search/products?q=...')만 호출 (브라우저 직접 RPC 호출 금지 — 과거 구조)

서버: src/routes/api/search/products/+server.ts
  1. search_products RPC(FTS+trgm+CTR 랭킹, 기존 자산)를 항상 1차 실행
  2. RPC 결과가 WEAK_MATCH_THRESHOLD(3건) 이하일 때 동의어 확장 + 자연어 폴백 실행:
     2a. loadSynonymGroups() + expandQueryWithConfirmedSynonyms(q, groups) → 확장어 목록 추출
     2b. 각 확장어로 search_products RPC 재조회 (세션/CTR 학습 제외, 결과 dedupe 병합)
     2c. 여전히 부족하면 원래 쿼리 + 확장어 전부 MiniSearch 자연어 폴백 (adapters/productSearchIndex.ts)
     2d. confirmed 동의어 그룹이 없거나 빈 배열이면 기존 동작과 100% 동일 (회귀 없음)
  3. product id 기준 dedupe, RPC 결과 항상 우선 — RPC를 대체하지 않고 보강만 함
  4. event.locals.safeGetSession()으로 로그인 세션 인식 → 로그인 고객 클릭이력이 CTR 개인화에 반영됨
     (FIX-2, 2026-08-06 — $lib/services/supabase anon 클라이언트로 세션 조회하던 과거 버그 수정됨)
  §E-2 (2026-08-15): 동의어 확장 검색 연동 완료 — "소니" 검색 시 confirmed 그룹에 "Sony"가 있으면
     Sony 상품이 RPC 재조회로 결과에 포함됨

DB: supabase/migrations/20260806000198_198_products_search_vector_extend.sql
  search_vector 트리거가 name > brand·slug·product_caption > keywords·content_blocks > category
  가중치로 색인. description 컬럼은 영구 미사용(products.md §2-10⑤)이라 가중치에서 제외됨.

캐시 무효화(FIX-1): invalidateProductSearchCache()가 상품 등록(new/+page.server.ts)·수정
  (updateSection 액션)·삭제(deleteProduct) 지점에 실제 연결되어 있음 — 값 바꿀 때 이 함수 호출부
  누락되지 않았는지 항상 확인.
```

---

## 2-2. 크레이지로그 검색 연동 (`/crazylog/list`, §I, 2026-08-07 신설)

```
클라이언트: src/routes/crazylog/list/+page.svelte
  → onSearchInput()이 280ms 디바운스 후 fetch('/api/search/crazylog?q=...&log_type=...')를 호출
  → displayPosts = $derived(searchQuery.trim() ? searchResults : data.posts) — 단일 파생값으로 탭 전환과 검색을 함께 구동
  → 탭 전환 시 search query가 활성 상태이면 goto() 대신 triggerSearch()를 재호출 (AND 조합)

서버: src/routes/api/search/crazylog/+server.ts
  → 순수 MiniSearch 전용 (하이브리드 RPC+MiniSearch 구조 없음 — 크레이지로그는 RPC FTS 인프라 없음)
  → getCrazylogSearchIndex() 호출 → fuzzy:0.2, prefix:true, limit×3 과조회 후 페이징
  → log_type 파라미터: 서버 측에서 MiniSearch 결과를 category 필드로 후필터 (AND 조합)
  → 응답 형식: { results, query, page, limit } — 상품검색 API와 동일 구조

어댑터: src/lib/server/searchEngine/adapters/crazylogSearchIndex.ts
  → 대상: user_posts (status='published' AND is_public=true) — 비공개·초안 문서 색인 제외
  → 저자명: user_profiles.id IN (user_ids) 로 별도 조회 후 authorMap 구성 (N+1 금지)
  → boost: title(5) > keywords_text·tags_text(3) > content_text·category(1)
  → content_text: extractContentBlocksText() — productSearchIndex.ts에서 재사용(export 공유)
  → TTL 60초 모듈 스코프 캐시 + invalidateCrazylogSearchCache()

테스트: src/__tests__/server/searchEngine/crazylogSearchIndex.test.ts
  → 17개 케이스 전부 통과 (2026-08-07)
  → published/public 필터 / fuzzy 매칭(3~4자 이상 — MiniSearch v7 max_edit = Math.round(len*0.2))
     prefix 부분일치 / boost 우선순위 / extractContentBlocksText 재사용 검증

⚠️ 2자 한국어 토큰 fuzzy 한계: Math.round(2 * 0.2) = 0 → edit distance 0 = 완전 일치만
   3자: Math.round(3 * 0.2) = 1 → 오타 1자 허용 / 4자: Math.round(4 * 0.2) = 1 → 오타 1자 허용
   → 짧은 브랜드명·약어 검색은 prefix:true 로 보완 (부분일치로 대체)
```

---

## 3. 상담채팅 자동매칭 연동 (`/cms/chat`)

```
1단계(키워드매칭, AI 무관): src/lib/server/matchCannedResponse.ts
  matchCannedResponse(message, candidates, synonymGroups = [])
  - match_keywords 채점: 옛 방식 그대로 유지(부분문자열 + 편집거리1, 4자 이상 한정) — keywordMatches()
  - title/shortcut/content 채점: MiniSearch(adapters/cannedResponseSearchIndex.ts) 기반
    boost 5>3>2>1(match_keywords>shortcut>title>content), fuzzy:0.2, prefix:true
  - synonymGroups(3번째 파라미터, 기본값 있는 옵셔널)로 match_keywords가 동의어 그룹까지 확장됨
  - 함수 계약: 순수함수 원칙 유지(내부에서 DB 직접 호출 안 함, 호출부가 데이터 다 채워서 넘김)

호출부: src/routes/api/chat/message/+server.ts (고객 메시지 자동매칭 — 이 파일은 필요한 경우
  외엔 수정 자제 원칙, 동의어 확장 삽입 등 예외는 Stephen 승인 하에 진행됨)
  - loadSynonymGroups()(synonymLearning.ts) 호출 → confirmed 동의어를 match_keywords에 확장 후
    matchCannedResponse() 호출 (TTL 60초 캐시 적용됨, FIX-3)
  - 2단계(매칭 실패 시): Claude Haiku(claude-haiku-4-5-20251001) 의도분류 폴백 — 이 로직은 불변

발신(학습 트리거): src/routes/api/chat/admin-reply/+server.ts
  - 관리자가 ChatInput.svelte에서 빠른답변을 "선택"만 하고 취소/다른 내용으로 덮어쓰면 학습 안 됨
  - 메시지가 실제로 chat_messages에 INSERT 성공한 시점에만 recordSynonymLearning() fire-and-forget 호출
```

---

## 4. 동의어 자동학습 (SYN 시리즈 + 2026-08-15 NLSearch 능동형 자연어 학습)

```
파일: src/lib/server/synonymLearning.ts

학습 트리거 1 (기존): 관리자가 빠른답변으로 "실제 발신"한 메시지의 직전 고객 메시지 토큰을 학습 후보로 기록
  (선택만 하고 취소하면 학습 안 됨 — §3 참고)

학습 트리거 2 (§C, 2026-08-15): 이중언어 병기 패턴 자동감지 (cross_lingual_pattern)
  - 상품 등록/수정 시 name·brand·caption·keywords 텍스트에서 "소니(Sony)" 패턴 자동 추출
  - 고객/관리자 채팅 메시지, CS 상담기록 저장 시 동일 패턴 감지
  - 파일: src/lib/server/crossLingualSynonymScan.ts
    registerCrossLingualCandidates(text)          — 단일 텍스트 처리, fire-and-forget
    registerCrossLingualCandidatesFromParts(parts) — 여러 텍스트 조각 합산 처리
  - weight=2 (upsert 2회): promote_threshold(기본 3) 대비 2번의 텍스트에서 관찰 시 자동 승격
  - 배선 위치: products/new/+page.server.ts, products/+page.server.ts,
               /api/chat/message, /api/chat/admin-reply, /api/chat/sessions/[id]/cs-record
  - 모두 fire-and-forget (.catch(() => {})) — 기존 저장/발신 흐름 절대 블록 안 함

핵심 함수:
  recordSynonymLearning()   학습 기록 진입점(기존 트리거 1) — 발신 성공 후 호출
  loadSynonymGroups()       confirmed 동의어 그룹 로드 (TTL 60초 캐시, FIX-3)
  isSimilarTerm()           유사 후보 판정 — 길이비례 편집거리 공식(SYN-12):
                             maxAllowedDistance = floor((min(a.length,b.length)-1) / DIVISOR)
                             DIVISOR 기본 3 → 4~6자:편집거리1 / 7~9자:편집거리2 / 2~3자:완전일치만
                             (완전일치·서브스트링 포함은 길이 무관 항상 병합)
  getOccurrenceWeight()     usage_count 구간별 학습 가중치(SYN-11) — 사용 많은 빠른답변일수록 빨리 승격
  loadSynonymSettings()     아래 튜닝 테이블에서 파라미터 로드 (TTL 60초 캐시, fallback 하드코딩값)

DB 테이블(전부 stage+production 적용 완료):
  synonym_groups            (id, canonical_term, created_at) — migration 199
  synonym_group_members     (id, group_id, term, source, status, occurrence_count,
                              first_observed_at, last_observed_at) — migration 199
    source CHECK: 'seed' | 'learned' | 'cross_lingual_pattern' | 'query_reformulation'
                  (migration 252에서 2개 추가 — Stage+Production 적용 완료, 2026-08-15)
    status CHECK: 'candidate' | 'confirmed'
  synonym_learning_settings (싱글턴 1행, promote_threshold=3, similarity_edit_distance_divisor=3,
                              usage_weight_tiers jsonb) — migration 200, RLS service_role 전용,
                              Supabase 대시보드에서 직접 값 수정 → 코드 배포 없이 즉시(최대 60초) 반영

RPC:
  find_or_create_synonym_group(p_canonical_term text) → uuid
  upsert_synonym_member(p_group_id uuid, p_term text, p_threshold int, p_source text DEFAULT 'learned')
    (migration 252에서 p_source 파라미터 추가 — 3-param 오버로드 제거, 4-param DEFAULT 'learned'로 하위호환)

관리 API (§D, 2026-08-15):
  POST /api/cms/synonyms/backfill-cross-lingual (§D-1)
    — products·chat_messages·cs_records 전체 순회, 500건 배치, 250초 타임아웃 가드
    — manager 이상 게이트, 처리/등록 통계 응답
  /cms/chat QnA 서브탭 "동의어 후보" (§D-2)
    — source IN ('cross_lingual_pattern', 'query_reformulation') 후보 목록
    — 수동 승격(→confirmed)/삭제 버튼, "병기패턴 재스캔" 버튼(D-1 호출)
    — hasSettingsAccess(manager 이상) 게이트, 기존 QnA 서브탭에 통합(신규 라우트 없음)

시드 데이터: '파손' 그룹 = {깨짐, 떨어짐, 파손, 부딪힘, 흠집, 균열} (전부 confirmed)
```

---

## 4-2. 재검색 행동 학습 (§G, 2026-08-15 신설)

```
목적: 고객이 "소니"로 검색해 0건이 나오고 곧바로 "Sony"로 재검색해 결과를 찾는 행동을
  동의어 후보 신호로 학습(cross_lingual_pattern과 달리 텍스트에 병기 표현이 없어도 학습 가능).

DB: supabase/migrations/20260815000253_253_nlsearch_query_reformulation_rpc.sql
  find_search_reformulation_pairs(p_lookback_days=30, p_window_seconds=120) — search_logs를
  세션 단위 LATERAL 자체조인, 순수 SELECT(새 테이블·컬럼 없음)
  오탐 방지 장치 7종: ①120초 시간창 ②원검색 result_count=0 ③재검색 result_count>0
  ④직후 1건 한정 ⑤어휘 sanity(2~30자, 서로 다른 문자열) ⑥lookback 30일 ⑦세션 키 존재

supabase/migrations/20260815000254_254_nlsearch_reformulation_cron.sql
  run_search_reformulation_scan() — find_search_reformulation_pairs 결과를 GROUP BY로
  집계해 find_or_create_synonym_group + upsert_synonym_member(source='query_reformulation',
  weight=1, 기존 promote_threshold 재사용)로 등록하는 순수 SQL 오케스트레이션 함수.
  pg_cron으로 매일 새벽 3시 자동 실행('search_reformulation_scan' job, migration 30/226과
  동일 cron.schedule() 컨벤션) — Stage+Production 적용 완료, 2026-08-15.

개인정보 원칙: session_key(세션/사용자 식별자)는 집계에도 최종 저장에도 사용하지 않음 —
  synonym_group_members에는 검색어 텍스트(term)만 저장됨.

관리자 수동 트리거(보조): src/lib/server/searchReformulationScan.ts (TS 경로, admin client) +
  POST /api/cms/synonyms/scan-reformulations — /cms/chat QnA 서브탭 "재검색패턴 재스캔" 버튼.
  자동(pg_cron 매일 새벽 3시)과 독립적으로 공존 — 관리자가 즉시 확인하고 싶을 때 사용.
```

---

## 5. 캐싱 정책 (전체 공통 패턴)

```
상품 인덱스(adapters/productSearchIndex.ts) / 동의어 그룹(synonymLearning.ts) /
빠른답변 인덱스(adapters/cannedResponseSearchIndex.ts) — 전부 동일한 모듈 스코프 TTL 60초 캐시 패턴.

새 캐시 대상을 추가할 땐 이 기존 패턴을 재사용할 것 — 새로운 캐싱 방식(Redis 등 외부 인프라) 도입 금지.
"운용 부담 없음"이 이 모듈 전체의 최우선 설계 원칙.
```

---

## 6. 절대 기억할 것

```
❌ minisearch 대신 pgvector·임베딩 API·MeiliSearch 등 신규 인프라 도입 금지
   (2026-08-06 세션에서 이미 검토 후 명시적으로 기각됨 — "운용 부담 없음" 원칙과 충돌)
❌ core/ 폴더에 crazyshot 전용 import(Supabase, $env, SvelteKit 타입) 추가 금지
❌ matchCannedResponse.ts 내부에서 DB 직접 호출 금지 (순수함수 원칙 유지)
❌ 기존 마이그레이션(113·198·199·200 등) 직접 수정 금지 — 신규 파일로만 확장
✅ NaturalSearchProvider 인터페이스를 만족하는 새 프로바이더(예: 향후 AI 임베딩 기반)를 추가할 땐
   core/에 나란히 배치하고 호출부는 프로바이더 교체만으로 대응 가능해야 함
```

---

*nlsearch.md v1.3 | Harness Flow v3.2 | 2026-08-06 신설(§A~§F) | 2026-08-07 갱신(§G~§J) —
H-1: components·specs 색인 추가 / J-2: 학습 기반 키워드 승격 / §I: 크레이지로그 검색엔진 신설
(crazylogSearchIndex.ts + /api/search/crazylog + /crazylog/list 검색 UI + 17개 테스트 완료) |
2026-08-15 NLSearch 능동형 자연어 학습 §A~§G 완료, Stage+Production 배포 완료 —
§A-1(migration 252): source CHECK 4값 + upsert_synonym_member 4-param,
§B(crossLingualPatternExtractor.ts + 10개 테스트),
§C(crossLingualSynonymScan.ts + 5개 훅 배선, content_blocks 포함),
§D(backfill API + QnA 서브탭 통합),
§E(synonymExpander.ts 순수함수 + 검색 API 동의어 확장 연동 + 10개 테스트),
§F(nlsearch.md §1·§2·§4 갱신),
§G(재검색 행동학습 — migration 253+254, pg_cron 매일 새벽 3시 자동 스캔 + 관리자 수동 재스캔
버튼 병행, 오탐방지 7종, 유닛테스트 6건) — §4-2 신설*
