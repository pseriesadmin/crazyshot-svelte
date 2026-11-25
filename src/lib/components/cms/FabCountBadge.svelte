<script lang="ts">
  // 모바일 현장앱 플로팅 아이콘 우측 상단 건수 배지 — 부모가 position: relative 여야 한다
  interface Props { count: number }
  let { count }: Props = $props()
  const label = $derived(count > 99 ? '99+' : String(count))
</script>

{#if count > 0}
  <span class="fab-count-badge" aria-hidden="true">{label}</span>
{/if}

<style>
  .fab-count-badge {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-full, 999px);
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    pointer-events: none;
    box-sizing: border-box;
  }
</style>
