<script lang="ts">
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'

  interface Product {
    id: string | number
    name: string
    category?: string
    price24h?: number | null
    price12h?: number | null
    isSaleOnly?: boolean
    salePrice?: number | null
    img: string
    href?: string
    wished?: boolean
  }

  interface Props {
    title?: string
    products?: Product[]
    /** G-3: 상품 클릭 시 호출 — recordSearchClick 배선용 */
    onProductClick?: (productId: string) => void
    /** 없으면 하트 미노출(비로그인) */
    onWishToggle?: (productId: string) => void
    /** 상품 0건일 때 "검색 결과가 없습니다" 안내를 숨김 — 아래에 다른 결과 섹션(크레이지로그)이 이어질 때 */
    hideEmpty?: boolean
    /** 아래에 결과 섹션이 이어 붙을 때 하단 패딩을 줄여 섹션 사이 간격이 이중으로 벌어지지 않게 */
    attached?: boolean
    /** 있으면 그리드 하단에 '더보기' 버튼 노출(검색 결과 12개씩 이어 보기) — 없으면 버튼 없음 */
    onLoadMore?: () => void
    /** 더보기 불러오는 중 — 버튼 비활성 */
    loadingMore?: boolean
    /** 헤더 건수에 쓰는 전체 건수 문구(예: '39', 서버에 더 있으면 '50+') — 없으면 보이는 개수(products.length) */
    totalLabel?: string
  }

  let {
    title = '검색 해봄',
    products = [],
    onProductClick,
    onWishToggle,
    hideEmpty = false,
    attached = false,
    onLoadMore,
    loadingMore = false,
    totalLabel,
  }: Props = $props()

</script>

{#if products.length > 0}
<section class="results-section" class:results-section--attached={attached}>
  <div class="results-inner">
    <div class="results-header">
      <h2 class="results-title">{title}</h2>
      <span class="results-count">{totalLabel ?? products.length}</span>
    </div>

      <!-- 표시 순서 = products 배열 순서(API search_products RPC 랭킹 그대로) -->
      <div class="product-grid">
        {#each products as p (p.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="product-grid-item" onclick={() => onProductClick?.(String(p.id))}>
            <ProductDPCard
              id={String(p.id)}
              name={p.name}
              category={p.category}
              imageUrl={p.img}
              price24h={p.price24h ?? null}
              price12h={p.price12h ?? null}
              isSaleOnly={p.isSaleOnly ?? false}
              salePrice={p.salePrice ?? null}
              href={p.href ?? `/products/${p.id}`}
              wished={p.wished ?? false}
              onWishToggle={onWishToggle ? () => onWishToggle(String(p.id)) : undefined}
            />
          </div>
        {/each}
      </div>

      {#if onLoadMore}
        <div class="more-wrap">
          <button type="button" class="more-btn" disabled={loadingMore} aria-busy={loadingMore} onclick={onLoadMore}>
            {loadingMore ? '불러오는 중…' : 'more'}
          </button>
        </div>
      {/if}
  </div>
</section>
{:else if !hideEmpty}
<section class="results-section results-section--empty">
  <div class="results-inner">
    <!-- "검색 결과가 없습니다." 문구를 줄이고 안내 문구 위에 SVG 배치(2026-10-06, PC·모바일 동일 구성 — 모바일은 PC×0.60 비율) -->
    <img class="empty-svg" src="/images/search-empty.svg" alt="" width="134" height="134" aria-hidden="true" />
    <p class="empty-msg"><span class="empty-title">검색 결과가 없습니다.</span><br class="empty-br"><span class="empty-hint">다른 키워드로 검색해보세요.</span></p>
  </div>
</section>
{/if}

<style>
  .results-section {
    width: 100%;
    padding: 0 25px 100px;
    background: var(--cs-bg-primary, #ffffff);
    border-radius: 0 50px 0 0;
  }
  .results-section--attached {
    padding-bottom: 20px;
  }
  /* 흰 섹션이 검색바~푸터 사이 남는 세로 공간을 채우고 아이콘+문구는 그 영역 세로 중앙에 둔다(PC·모바일 공통)
     — 부모 main이 flex 컬럼일 때 동작(search/+page.svelte의 :has() 규칙 참고) */
  .results-section--empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 25px;         /* PC 80px × 0.60 */
    text-align: center;
  }
  .results-section--empty .results-inner {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;                  /* PC 24px × 0.60 */
  }
  .empty-msg {
    font: var(--text-m-script-14);   /* 모바일: 한 단계 작은 토큰(14px Medium) — 글자는 0.60 배율 대신 토큰 단계 적용 */
    color: var(--cs-text-mid, #666666);
    line-height: 1.7;
  }
  .empty-svg {
    display: block;
    width: 80px;                /* PC 134px × 0.60 */
    height: 80px;
  }
  .empty-title,
  .empty-br {
    display: none;
  }
  @media (min-width: 1024px) {
    .results-section {
      padding: 0 100px 80px;
    }
    .results-section--attached {
      padding-bottom: 20px;
    }
  }

  .results-inner {
    max-width: 1600px;
    margin: 0 auto;
  }
  .results-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* 모바일: 상단만 18px → 23.4px(+30%, 요청 2026-10-06) — 흰 섹션 라운드 모서리와 제목이 붙어 보이던 문제.
       섹션 자체 padding-top 대신 헤더 padding-top을 늘린 이유: 이 섹션은 빈 상태·이어붙는 섹션(attached)과 padding을 공유해
       섹션 쪽을 건드리면 다른 상태의 간격까지 함께 바뀌고, 하단(그리드와의 간격)은 그대로 둘 수 있어서 */
    padding: 23.4px 0 18px;
  }
  .results-title {
    margin: 0;
    font: var(--text-m-body-16L);    /* 모바일: 한 단계 작은 토큰(16px Medium) */
    line-height: 1.6;
    letter-spacing: -0.3px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }
  .results-count {
    font: var(--text-m-script-14);   /* 모바일: 한 단계 작은 토큰(14px Medium) */
    line-height: 1.6;
    letter-spacing: -0.5px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }

  /* 모바일 2열 — /products .m-prod-grid 동일 패턴(flex + calc(50% - 5px), 2026-09-28) */
  .product-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 26px 10px;
  }
  .product-grid-item {
    width: calc(50% - 5px);
    min-width: 0;
    box-sizing: border-box;
  }
  .product-grid-item :global(.pc-card) {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    flex-shrink: 1;
  }
  .product-grid-item :global(.pc-img-wrap) {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    flex-shrink: 1;
  }

  @media (min-width: 768px) {
    /* PC — 결과 헤더 원래 크기 복원 */
    .results-header {
      padding: 30px 0;
    }
    .results-title {
      font-size: 18px;
    }
    .results-count {
      font-size: 16px;
    }
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 60px 30px;
    }
    .product-grid-item {
      width: auto;
    }
  }

  /* 더보기 버튼 — front-uiux §5 보조 버튼 값에서 높이만 30% 줄임(좌우 20·30px 반경, 가로 100%) + 옅은 퍼플 면(2026-10-27 Stephen 지시: BG --cs-lilac(더 옅게), 글자 --cs-purple-dark(짙은 퍼플), 호버는 배경만 한 단계 진한 --cs-purple-op10, 높이 30% 축소(모바일 31·PC 35), 글자 크기는 모바일 14px(--text-m-script-14B)·PC 16px로 모바일이 한 단계 작게) */
  .more-wrap {
    display: flex;
    justify-content: center;
    margin-top: 40px;
  }
  .more-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 31px;                /* 기존 44px × 0.7(30% 축소, 2026-10-27 Stephen 지시) */
    padding: 0 20px;
    background: var(--cs-lilac);
    color: var(--cs-purple-dark);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-m-script-14B);
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .more-btn:hover { background: var(--cs-purple-op10); }
  .more-btn:disabled { color: var(--cs-text-light); cursor: not-allowed; }
  .more-btn:disabled:hover { background: var(--cs-lilac); }
  /* 눈에 보이는 높이만 줄이고 눌리는 영역은 터치 타겟 44px(front-uiux §7) 이상 유지 — 보이지 않는 영역을 위아래로 넓힌다 */
  .more-btn::after {
    content: '';
    position: absolute;
    inset: -7px 0;               /* 31px + 14px = 45px */
  }

  @media (min-width: 768px) {
    /* PC — 높이 35(기존 50 × 0.7)·좌우 30·PC 타이포(16px), 가로폭은 320px로 제한하고 가운데 정렬 */
    .more-wrap { margin-top: 60px; }
    .more-btn {
      max-width: 320px;
      height: 35px;              /* 기존 50px × 0.7 */
      padding: 0 30px;
      font: var(--text-pc-title-16);
    }
    .more-btn::after { inset: -5px 0; }  /* 35px + 10px = 45px */
  }

  /* PC — 검색 결과 없음: 모바일(×0.60) 값을 원래 크기로 복원 */
  @media (min-width: 768px) {
    .results-section--empty {
      padding: 80px 25px;
    }
    .results-section--empty .results-inner {
      gap: 24px;
    }
    .empty-svg {
      width: 134px;
      height: 134px;
    }
    .empty-msg {
      font-size: 15px;            /* PC 기존 값 유지 */
    }
  }
</style>
