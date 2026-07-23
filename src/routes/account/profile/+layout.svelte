<script lang="ts">
  let { children } = $props()
</script>

{@render children()}

<style>
  /* profile 서브 화면: SubGnb가 내비를 담당하므로 전역 GNB·FAB 전 해상도 차단 */
  :global(.gnb-desktop-wrap),
  :global(.gnb-mobile-wrap),
  :global(.fab-bar) {
    display: none !important;
  }
  /* 전역 GNB 없으므로 SubGnb sticky top 오프셋 초기화 */
  :global(.sub-gnb-pc) {
    top: 0 !important;
  }
</style>
