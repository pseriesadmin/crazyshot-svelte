<script lang="ts">
  let { children } = $props()
</script>

{@render children()}

<!-- [2026-09-29] 아래 숨김 규칙을 컴포넌트 <style>(:global)에서 <svelte:head> 스타일로 이동 — :global 규칙은 화면 이동 후에도 문서에 남아
     다른 화면(상품·하입팩·헬프 등)의 플로팅 메뉴·GNB까지 계속 숨기는 결함이 있었음. head 스타일은 이 레이아웃이 사라질 때 자동 제거된다. -->
<svelte:head>
  <style>
    /* profile 서브 화면: SubGnb가 내비를 담당하므로 전역 GNB·FAB 전 해상도 차단 */
    .gnb-desktop-wrap,
    .gnb-mobile-wrap,
    .fab-bar {
      display: none !important;
    }
    /* 전역 GNB 없으므로 SubGnb sticky top 오프셋 초기화 */
    .sub-gnb-pc {
      top: 0 !important;
    }
  </style>
</svelte:head>

