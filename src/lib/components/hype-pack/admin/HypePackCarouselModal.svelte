<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="추천 HypePack 캐러셀 설정" {onclose}>
  <p class="placeholder-note">
    추천 HypePack 섹션의 캐러셀에 노출할 상품·패키지를 설정합니다.
  </p>
  <!-- TODO: 캐러셀 상품 선택 + 순서 UI -->
</AdminModalShell>

<style>
  .placeholder-note {
    font-size: 14px;
    color: var(--cs-text-mid);
    line-height: 1.6;
    background: var(--cs-lilac);
    border-radius: var(--radius-md);
    padding: 16px;
  }
</style>
