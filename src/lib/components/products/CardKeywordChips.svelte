<script lang="ts">
  import { truncateKeywordLabel } from '$lib/utils/keywordDisplay'

  /** 상품 카드·상세 제목 영역 공통 — CMS 에서 카드 노출로 선택한 키워드를 라운드 바로 표시. 고객 화면에서는 '#' 없이 글자만 보인다(CMS 칩은 '#' 유지, 2026-11-17) */
  let { keywords = [] }: { keywords?: string[] } = $props()
</script>

{#if keywords.length > 0}
  <p class="pc-kw-row">
    {#each keywords as kw (kw)}<span class="pc-kw">{truncateKeywordLabel(kw)}</span>{/each}
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
    padding: 3.84px 16.2px; /* 모바일 상하 4.8→3.84px(−20%, 2026-11-17 Stephen 지시), 좌우 16.2px 불변 */
    border-radius: var(--radius-full);
    background: var(--cs-purple-40); /* 밝은 퍼플 purple-40 #9383FF — 2026-11-18 Stephen 지시(카드·상세 공통. 같은 날 레드 톤을 잠시 적용했다가 되돌림) */
    color: var(--cs-white);
    font: var(--text-m-tag-11); /* 모바일 11px Bold(토큰이 700 포함) — 12→11px 한 사이즈 작게(2026-11-17 Stephen 지시) */
    line-height: 1.2;
    white-space: nowrap;
  }
  @media (min-width: 768px) {
    /* PC: 폰트 14px(--text-pc-body-14, 16px에서 한 사이즈 작게 — 2026-11-17 Stephen 지시), 상하 4→8px(×2)·좌우 9→27px(×3) */
    .pc-kw {
      padding: 8px 27px;
      font: var(--text-pc-body-14);
      line-height: 1.2;
    }
  }

</style>
