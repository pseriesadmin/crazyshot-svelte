<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="PICK 상품 설정" {onclose}>
  <p class="placeholder-note">
    홈 화면 취향직격 PICK·미칠 PICK 슬라이더에 노출할 상품을 설정합니다.
  </p>
  <!-- TODO: 상품 검색 + 순서 설정 UI -->
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
