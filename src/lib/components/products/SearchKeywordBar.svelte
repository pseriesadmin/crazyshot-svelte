<script lang="ts">
  import { truncateKeywordLabel } from '$lib/utils/keywordDisplay'

  interface Props {
    keywords?: string[]
    onkeywordclick?: (kw: string) => void
  }

  let {
    keywords = [],
    onkeywordclick,
  }: Props = $props()
</script>

{#if keywords.length > 0}
<section class="keywords-section">
  <div class="keywords-inner">
    <div class="title-bar">
      <h2 class="title-text">관심집중 키워드</h2>
    </div>

    <div class="chip-bar">
      {#each keywords as kw, i (i)}
        <button
          class="chip"
          title={kw}
          aria-label={kw}
          onclick={() => onkeywordclick?.(kw)}
        >{truncateKeywordLabel(kw)}</button>
      {/each}
    </div>
  </div>
</section>
{/if}

<style>
  .keywords-section {
    width: 100%;
    padding: 0 25px;
  }
  @media (min-width: 1024px) {
    .keywords-section {
      padding: 0 100px;
    }
  }
  .keywords-inner {
    max-width: 1600px;
    margin: 0 auto;
    padding-bottom: 50px;
  }
  .title-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 40px;
    padding-bottom: 25px;
  }
  /* 모바ile 섹션 헤더 — /products .m-sec-label(21px)과 동급, 18B(소제목)보다 한 단계 큰 공식 토큰
     (18↔21 사이 중간 토큰 없음 — uiux-index Mobile heading-lg = --text-m-title-21) */
  .title-text {
    font: var(--text-m-title-21);
    letter-spacing: -0.3px;
    color: var(--cs-text);
    margin: 0;
  }
  @media (min-width: 768px) {
    .title-text {
      font: var(--text-pc-title-18);
    }
  }
  .chip-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .chip {
    padding: 8px 25px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.6;
    letter-spacing: -0.5px;
    white-space: nowrap;
    background: #e1def3;
    color: #444444;
    border-radius: 13px;
    border: none;
    cursor: pointer;
    font-family: 'Noto Sans KR', sans-serif;
    transition: background 0.15s;
    min-height: 44px;
  }
  .chip:hover {
    background: #c1bbec;
  }
</style>
