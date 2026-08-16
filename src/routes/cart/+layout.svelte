<script lang="ts">
  let { children } = $props();
</script>

<!-- checkout 라우트: 전역 레이아웃(헤더/푸터) 없이 독립 렌더링 -->
{@render children()}

<style>
  :global(body) { margin: 0; padding: 0; }
  /* 부모 레이아웃의 헤더·푸터 숨김 (checkout 전용 UI 사용) */
  :global(.min-h-screen > header),
  :global(.min-h-screen > footer) { display: none !important; }
  :global(.min-h-screen) { min-height: unset !important; }
  :global(.flex-1) { flex: unset !important; }
</style>
