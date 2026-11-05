<script module lang="ts">
  export interface SearchManual {
    productId: string
    productName: string
    /** 상품 대표 썸네일(검색 결과의 상품 이미지 첫 장) */
    imageUrl: string
    slug: string | null
    path: string
    name: string
  }
</script>

<script lang="ts">
  import PdfModal from '$lib/components/common/PdfModal.svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import { manualPublicUrl } from '$lib/utils/productManuals'
  import { getSupabaseUrl } from '$lib/env/supabasePublic'

  interface Props {
    manuals?: SearchManual[]
    /** 위에 상품 결과 섹션이 없을 때(첫 섹션) 우상단 라운드·상단 패딩 적용 */
    topRound?: boolean
  }

  let { manuals = [], topRound = false }: Props = $props()

  let openIndex = $state<number | null>(null)
  const openManual = $derived(openIndex !== null ? (manuals[openIndex] ?? null) : null)
</script>

{#if manuals.length > 0}
<section class="manual-section" class:manual-section--top={topRound}>
  <div class="manual-inner">
    <div class="manual-header">
      <h2 class="manual-title">상품설명서</h2>
      <span class="manual-count">{manuals.length}</span>
    </div>

    <!-- 표시 순서 = 상품 검색 랭킹 순서 그대로 -->
    <ul class="manual-list">
      {#each manuals as m, i (m.path)}
        <li>
          <button type="button" class="manual-item" onclick={() => (openIndex = i)} aria-label={`${m.productName} ${m.name} 상품설명서 보기`}>
            <img class="manual-thumb" src={m.imageUrl} alt="" loading="lazy" />
            <span class="manual-text">
              <span class="manual-product">{m.productName}</span>
              <span class="manual-name">{m.name}</span>
            </span>
            <ChevronIcon size={8} />
          </button>
        </li>
      {/each}
    </ul>
  </div>
</section>
{/if}

{#if openManual}
  <PdfModal
    src={manualPublicUrl(openManual.path, getSupabaseUrl())}
    title={openManual.name}
    downloadUrl={manualPublicUrl(openManual.path, getSupabaseUrl())}
    downloadFilename={openManual.name}
    onclose={() => (openIndex = null)}
    simple
  />
{/if}

<style>
  /* 상품 결과 섹션과 같은 흰 섹션 — 바로 아래에 이어 붙는다(크레이지로그 섹션과 동일 규격) */
  .manual-section {
    width: 100%;
    padding: 0 25px 60px;
    background: var(--cs-bg-primary, #ffffff);
  }
  .manual-section--top {
    border-radius: 0 50px 0 0;
  }
  @media (min-width: 1024px) {
    .manual-section {
      padding: 0 100px 60px;
    }
  }
  .manual-inner {
    max-width: 1600px;
    margin: 0 auto;
  }
  .manual-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 36.4px 0 18px;          /* 위 섹션과의 간격: 상품 결과 하단 20 + 23.4 = 43.4px → +30% = 56.4px */
  }
  .manual-title {
    margin: 0;
    font: var(--text-m-body-16L);
    line-height: 1.6;
    letter-spacing: -0.3px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }
  .manual-count {
    font: var(--text-m-script-14);
    line-height: 1.6;
    letter-spacing: -0.5px;
    color: var(--cs-text-dark, #444444);
    font-family: 'Noto Sans KR', sans-serif;
  }

  /* 항목 — 상품상세 정보 탭의 설명서 항목(.manual-item)과 같은 면 색·호버 */
  .manual-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .manual-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    padding: 16px;
    border: none;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--cs-surface-gray) 50%, var(--cs-white)); /* --cs-surface-gray(#f6f6f6)를 흰색과 반반 섞은 더 옅은 회색(≈#fbfbfb) — 더 옅은 회색 전용 토큰은 없음 */
    color: var(--cs-text);
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }
  .manual-item:hover {
    background: var(--cs-lilac);
  }
  .manual-thumb {
    flex-shrink: 0;
    width: 84px; /* 40px × 3 = 120px 에서 30% 축소 (PC·모바일 공통) */
    height: 84px;
    object-fit: cover;
    background: var(--cs-lilac);
    border-radius: var(--cms-radius-sm); /* 상품 이미지 반경 10px (front-uiux §4 image) */
  }
  .manual-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .manual-product {
    font: var(--text-m-script-14B);
    line-height: 1.6; /* 토큰 기본 200%는 줄이 커져 1.6으로 */
    color: var(--cs-text-dark);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .manual-name {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (min-width: 768px) {
    .manual-name { font: var(--text-pc-script-12); }
    .manual-product { font: var(--text-pc-title-16); line-height: 1.6; }
  }
</style>
