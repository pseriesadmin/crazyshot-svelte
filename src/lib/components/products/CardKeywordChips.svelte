<script lang="ts">
  import { truncateKeywordLabel } from '$lib/utils/keywordDisplay'

  /** 상품 카드·상세 제목 영역 공통 — CMS 에서 카드 노출로 선택한 키워드를 라운드 바로 표시 */
  let { keywords = [] }: { keywords?: string[] } = $props()
</script>

{#if keywords.length > 0}
  <p class="pc-kw-row">
    {#each keywords as kw (kw)}<span class="pc-kw">#{truncateKeywordLabel(kw)}</span>{/each}
  </p>
{/if}

<style>
  /* 라운드 바(면 컬러, 보더 없음). 한 줄 고정, 넘치면 잘림 */
  .pc-kw-row {
    display: flex;
    flex-wrap: nowrap;
    gap: 6px;
    margin: 0;
    width: 100%;
    overflow: hidden;
  }
  /* 모바일 = PC 값 × 0.60(상하 8→4.8px·좌우 27→16.2px), 폰트는 모바일 토큰 14px Bold(PC 16px) — 2026-11-16 Stephen 지시 */
  .pc-kw {
    flex: 0 0 auto;
    padding: 4.8px 16.2px;
    border-radius: var(--radius-full);
    background: var(--cs-lilac);
    color: var(--cs-purple-light);
    font: var(--text-m-script-14);
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
  }
  @media (min-width: 768px) {
    /* PC: 폰트 16px(11→12→14→16 세 단계 업), 상하 4→8px(×2)·좌우 9→27px(×3) */
    .pc-kw {
      padding: 8px 27px;
      font: var(--text-pc-title-16);
      line-height: 1.2;
    }
  }

</style>
