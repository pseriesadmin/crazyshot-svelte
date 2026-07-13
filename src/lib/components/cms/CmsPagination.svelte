<script lang="ts">
  interface Props {
    /** 현재 페이지 (1-indexed) */
    page: number
    /** 전체 페이지 수 */
    totalPages: number
    /** 페이지 변경 콜백 */
    onpage: (p: number) => void
    /** 배치 위치: top(수평·수직 중앙, min-height 44px) / bottom(수평 중앙, margin-top 20px) / inline(기본) */
    variant?: 'top' | 'bottom' | 'inline'
    /** 접근성 레이블 */
    ariaLabel?: string
  }

  let {
    page,
    totalPages,
    onpage,
    variant = 'inline',
    ariaLabel = '페이지 탐색',
  }: Props = $props()

  const canPrev = $derived(page > 1)
  const canNext = $derived(page < totalPages)
  const hasPagination = $derived(totalPages > 1)

  const visiblePages = $derived.by(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    let start = Math.max(1, page - 2)
    const end = Math.min(totalPages, start + 4)
    if (end - start < 4) start = Math.max(1, end - 4)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  })
</script>

<div
  class="cms-pagination"
  class:cms-pagination-top={variant === 'top'}
  class:cms-pagination-bottom={variant === 'bottom'}
  role="navigation"
  aria-label={ariaLabel}
>
  <!-- 이전 버튼 -->
  <button
    type="button"
    class="pag-nav-btn"
    onclick={() => canPrev && onpage(page - 1)}
    disabled={!canPrev}
    aria-label="이전 페이지"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="11" fill={canPrev ? 'rgba(59,47,138,0.08)' : '#F6F6F6'}/>
      <path d="M13 7L9.57075 10.2727C8.81006 11 8.80949 11 9.57075 11.7273L13 15"
        stroke={canPrev ? '#3B2F8A' : '#AAAAAA'} stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <!-- 페이지 번호 -->
  <div class="pag-numbers" aria-label="페이지 목록">
    {#if hasPagination}
      {#each visiblePages as p (p)}
        <button
          type="button"
          class="pag-num"
          class:pag-num-active={p === page}
          onclick={() => onpage(p)}
          aria-label="{p}페이지"
          aria-current={p === page ? 'page' : undefined}
        >{p}</button>
      {/each}
    {:else}
      <span class="pag-info-text">{page}</span>
    {/if}
  </div>

  <!-- 다음 버튼 -->
  <button
    type="button"
    class="pag-nav-btn"
    onclick={() => canNext && onpage(page + 1)}
    disabled={!canNext}
    aria-label="다음 페이지"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="11" fill={canNext ? 'rgba(59,47,138,0.08)' : '#F6F6F6'}/>
      <path d="M10 7L13.4292 10.2727C14.1899 11 14.1905 11 13.4292 11.7273L10 15"
        stroke={canNext ? '#3B2F8A' : '#AAAAAA'} stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>
</div>

<style>
  .cms-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .cms-pagination-top {
    min-height: 44px;
  }
  .cms-pagination-bottom {
    margin-top: 20px;
  }

  /* 이전/다음 버튼 */
  .pag-nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    transition: opacity 0.12s;
  }
  .pag-nav-btn:not(:disabled) { opacity: 1; }
  .pag-nav-btn:disabled       { opacity: 0.5; cursor: default; }
  .pag-nav-btn:hover:not(:disabled) { opacity: 0.75; }

  /* 페이지 번호 */
  .pag-numbers {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pag-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .pag-num:hover { background: rgba(59,47,138,0.06); color: var(--cs-text); }
  .pag-num.pag-num-active {
    background: var(--cs-purple);
    color: var(--cs-white);
    font-weight: 700;
    cursor: default;
  }
  .pag-info-text {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    padding: 0 8px;
  }
</style>
