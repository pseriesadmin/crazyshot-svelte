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
    index.ts                  공개 export barrel — 이 폴더 전체가 이식/패키징 단위

  adapters/                 ← crazyshot DB 스키마를 core가 이해하는 문서 포맷으로 변환하는 접착 코드
    productSearchIndex.ts     상품 검색 인덱스 (부모 상품만, TTL 60초 캐시, invalidateProductSearchCache())
    cannedResponseSearchIndex.ts  빠른답변 검색 인덱스 (TTL 60초 캐시, invalidateCannedResponseIndex())

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
  2. RPC 결과가 WEAK_MATCH_THRESHOLD(3건) 이하일 때만 adapters/productSearchIndex.ts 자연어 폴백 실행
  3. product id 기준 dedupe, RPC 결과 항상 우선 — RPC를 대체하지 않고 보강만 함
  4. event.locals.safeGetSession()으로 로그인 세션 인식 → 로그인 고객 클릭이력이 CTR 개인화에 반영됨
     (FIX-2, 2026-08-06 — $lib/services/supabase anon 클라이언트로 세션 조회하던 과거 버그 수정됨)

DB: supabase/migrations/20260806000198_198_products_search_vector_extend.sql
  search_vector 트리거가 name > brand·slug·product_caption > keywords·content_blocks > category
  가중치로 색인. description 컬럼은 영구 미사용(products.md §2-10⑤)이라 가중치에서 제외됨.

캐시 무효화(FIX-1): invalidateProductSearchCache()가 상품 등록(new/+page.server.ts)·수정
  (updateSection 액션)·삭제(deleteProduct) 지점에 실제 연결되어 있음 — 값 바꿀 때 이 함수 호출부
  누락되지 않았는지 항상 확인.
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

## 4. 동의어 자동학습 (SYN 시리즈)

```
파일: src/lib/server/synonymLearning.ts

학습 트리거: 관리자가 빠른답변으로 "실제 발신"한 메시지의 직전 고객 메시지 토큰을 학습 후보로 기록
  (선택만 하고 취소하면 학습 안 됨 — §3 참고)

핵심 함수:
  recordSynonymLearning()   학습 기록 진입점 — 발신 성공 후 호출
  loadSynonymGroups()       confirmed 동의어 그룹 로드 (TTL 60초 캐시, FIX-3)
  isSimilarTerm()           유사 후보 판정 — 길이비례 편집거리 공식(SYN-12):
                             maxAllowedDistance = floor((min(a.length,b.length)-1) / DIVISOR)
                             DIVISOR 기본 3 → 4~6자:편집거리1 / 7~9자:편집거리2 / 2~3자:완전일치만
                             (완전일치·서브스트링 포함은 길이 무관 항상 병합)
  getOccurrenceWeight()     usage_count 구간별 학습 가중치(SYN-11) — 사용 많은 빠른답변일수록 빨리 승격
  loadSynonymSettings()     아래 튜닝 테이블에서 파라미터 로드 (TTL 60초 캐시, fallback 하드코딩값)

DB 테이블(전부 stage+production 적용 완료, 2026-08-06):
  synonym_groups            (id, canonical_term, created_at) — migration 199
  synonym_group_members     (id, group_id, term, source['seed'|'learned'], status['candidate'|'confirmed'],
                              occurrence_count, first_observed_at, last_observed_at) — migration 199
  synonym_learning_settings (싱글턴 1행, promote_threshold=3, similarity_edit_distance_divisor=3,
                              usage_weight_tiers jsonb) — migration 200, RLS service_role 전용,
                              Supabase 대시보드에서 직접 값 수정 → 코드 배포 없이 즉시(최대 60초) 반영

RPC: find_or_create_synonym_group(p_canonical_term), upsert_synonym_member(p_group_id, p_term, p_threshold)

시드 데이터: '파손' 그룹 = {깨짐, 떨어짐, 파손, 부딪힘, 흠집, 균열} (전부 confirmed)
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

*nlsearch.md v1.0 | Harness Flow v3.2 | 2026-08-06 신설 — §A~§F 전체 구현 완료 시점 기준 정본*
