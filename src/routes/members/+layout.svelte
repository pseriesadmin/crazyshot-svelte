<script lang="ts">
  let { children } = $props()
</script>

{@render children()}

<style>
  /* Members 페이지: 모바일(<1024px)에서 공통 GNB·FloatingBar 숨김
     (모바일 전용 자체 네비가 히어로 내부에 있음) */
  @media (max-width: 1023px) {
    :global(.gnb-desktop-wrap),
    :global(.fab-bar) {
      display: none !important;
    }
  }
</style>
