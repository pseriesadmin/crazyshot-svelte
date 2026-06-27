<script lang="ts">
  import { goto } from '$app/navigation'
  import { enhance } from '$app/forms'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 코드설정에서 가져온 동적 카테고리 목록
  const CATEGORIES = $derived([
    { value: 'all', label: '전체' },
    ...data.categories,
  ])

  const CATEGORY_LABEL = $derived(
    Object.fromEntries(data.categories.map((c) => [c.value, c.label]))
  )

  let searchInput = $state(data.q)

  function onCategoryClick(value: string) {
    const params = new URLSearchParams()
    if (value !== 'all') params.set('category', value)
    if (searchInput) params.set('q', searchInput)
    goto(`/cms/products?${params.toString()}`)
  }

  function onSearch(e: Event) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (data.category !== 'all') params.set('category', data.category)
    if (searchInput) params.set('q', searchInput)
    goto(`/cms/products?${params.toString()}`)
  }

  function formatPrice(price: number | null): string {
    if (price == null) return '—'
    return price.toLocaleString('ko-KR') + '원'
  }

  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.startsWith('http')) return first
    return `https://res.cloudinary.com/crazyshot/image/upload/w_80,h_80,c_fill,f_auto,q_auto/${first}.jpg`
  }
</script>

<svelte:head><title>상품목록 — CrazyShot CMS</title></svelte:head>

<div class="products-wrap">

  <!-- 카테고리 탭 -->
  <div class="cat-tabs" role="tablist" aria-label="상품 카테고리">
    {#each CATEGORIES as cat}
      <button
        role="tab"
        aria-selected={data.category === cat.value}
        class="cat-tab"
        class:active={data.category === cat.value}
        onclick={() => onCategoryClick(cat.value as string)}
      >{cat.label}</button>
    {/each}
  </div>

  <!-- 검색 + 등록 버튼 -->
  <div class="toolbar">
    <form class="search-form" onsubmit={onSearch}>
      <input
        class="f-input search-input"
        type="search"
        placeholder="상품명으로 검색"
        bind:value={searchInput}
        aria-label="상품 검색"
      />
      <button type="submit" class="search-btn">검색</button>
    </form>
    <a href="/cms/products/new" class="cta-btn">+ 상품등록</a>
  </div>

  <!-- 상품 테이블 -->
  <div class="table-card">
    {#if data.products.length === 0}
      <div class="empty-state">
        <p class="empty-msg">등록된 상품이 없습니다.</p>
        <a href="/cms/products/new" class="cta-btn">첫 상품 등록하기</a>
      </div>
    {:else}
      <table class="product-table" aria-label="상품 목록">
        <thead>
          <tr>
            <th class="col-thumb">이미지</th>
            <th class="col-cat">카테고리</th>
            <th class="col-name">상품명</th>
            <th class="col-brand">브랜드</th>
            <th class="col-price">일일가격(24h)</th>
            <th class="col-stock">보유수량</th>
            <th class="col-status">상태</th>
            <th class="col-action">관리</th>
          </tr>
        </thead>
        <tbody>
          {#each data.products as product (product.id)}
            <tr class="product-row">
              <td class="col-thumb">
                {#if product.image_urls.length > 0}
                  <img
                    src={thumbUrl(product.image_urls)}
                    alt={product.name}
                    class="thumb-img"
                    width="56"
                    height="56"
                    loading="lazy"
                  />
                {:else}
                  <div class="thumb-empty" aria-label="이미지 없음">—</div>
                {/if}
              </td>
              <td class="col-cat">
                <span class="cat-badge">{CATEGORY_LABEL[product.category] ?? product.category}</span>
              </td>
              <td class="col-name">
                <span class="product-name">{product.name}</span>
                <span class="product-slug">{product.slug}</span>
              </td>
              <td class="col-brand">{product.brand ?? '—'}</td>
              <td class="col-price">{formatPrice(product.price24h)}</td>
              <td class="col-stock">{product.assetCount}개</td>
              <td class="col-status">
                <form
                  method="POST"
                  action="?/toggleStatus"
                  use:enhance
                  class="toggle-form"
                >
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="is_active" value={product.is_active.toString()} />
                  <button
                    type="submit"
                    class="status-badge"
                    class:active={product.is_active}
                    aria-label={product.is_active ? '비활성화' : '활성화'}
                    title={product.is_active ? '클릭하여 비활성화' : '클릭하여 활성화'}
                  >
                    {product.is_active ? '활성' : '비활성'}
                  </button>
                </form>
              </td>
              <td class="col-action">
                <a href={`/cms/products/${product.id}/edit`} class="edit-btn">수정</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

</div>

<style>
  .products-wrap {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    height: 100%;
    overflow-y: auto;
  }

  /* 카테고리 탭 */
  .cat-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 16px;
    background: var(--cs-white);
    border-radius: var(--radius-xl);
  }
  .cat-tab {
    padding: 6px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-m-script-14B);
    cursor: pointer;
    min-height: 36px;
    transition: background 0.12s, color 0.12s;
  }
  .cat-tab:hover  { background: var(--cs-lilac); color: var(--cs-text); }
  .cat-tab.active { background: var(--cs-purple); color: var(--cs-white); }

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .search-form {
    display: flex;
    gap: 8px;
    flex: 1;
  }
  .search-input {
    flex: 1;
    height: 44px;
    padding: 0 16px;
  }
  .search-btn {
    height: 44px;
    padding: 0 20px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--cs-lilac);
    color: var(--cs-text);
    font: var(--text-m-script-14B);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .search-btn:hover { background: var(--cs-purple-op10); }
  .cta-btn {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border-radius: var(--radius-xl);
    font: var(--text-m-script-14B);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .cta-btn:hover { background: var(--cs-purple-hover); }

  /* 테이블 카드 */
  .table-card {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    overflow: hidden;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 60px 20px;
  }
  .empty-msg {
    font: var(--text-m-body-16L);
    color: var(--cs-text-light);
  }

  /* 테이블 */
  .product-table {
    width: 100%;
    border-collapse: collapse;
  }
  thead tr {
    background: var(--cs-lilac);
  }
  th {
    padding: 12px 14px;
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid rgba(59,47,138,0.08);
  }
  .product-row {
    border-bottom: 1px solid rgba(59,47,138,0.06);
    transition: background 0.1s;
  }
  .product-row:hover { background: rgba(236,235,244,0.4); }
  .product-row:last-child { border-bottom: none; }
  td { padding: 12px 14px; vertical-align: middle; }

  /* 컬럼 너비 */
  .col-thumb  { width: 72px; }
  .col-cat    { width: 80px; }
  .col-brand  { width: 100px; }
  .col-price  { width: 120px; white-space: nowrap; }
  .col-stock  { width: 80px; text-align: center; }
  .col-status { width: 80px; }
  .col-action { width: 64px; }

  .thumb-img {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    display: block;
  }
  .thumb-empty {
    width: 56px;
    height: 56px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cs-text-light);
    font: var(--text-m-script-12);
  }

  .cat-badge {
    display: inline-block;
    padding: 2px 8px;
    background: var(--cs-lilac);
    color: var(--cs-purple);
    border-radius: var(--radius-xs);
    font: var(--text-m-script-12);
    white-space: nowrap;
  }

  .product-name {
    display: block;
    font: var(--text-m-script-14B);
    color: var(--cs-text);
  }
  .product-slug {
    display: block;
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    margin-top: 2px;
  }

  .toggle-form { display: inline; }
  .status-badge {
    display: inline-block;
    padding: 4px 10px;
    border: none;
    border-radius: var(--radius-xs);
    font: var(--text-m-script-12);
    cursor: pointer;
    background: var(--cs-surface-gray);
    color: var(--cs-text-light);
    transition: background 0.12s, color 0.12s;
    min-height: 28px;
  }
  .status-badge.active {
    background: rgba(85,63,224,0.12);
    color: var(--cs-purple-light);
  }
  .status-badge:hover { opacity: 0.75; }

  .edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    background: var(--cs-dark);
    color: var(--cs-white);
    border-radius: var(--radius-sm);
    font: var(--text-m-script-12);
    text-decoration: none;
    min-height: 32px;
    transition: opacity 0.12s;
  }
  .edit-btn:hover { opacity: 0.8; }
</style>
