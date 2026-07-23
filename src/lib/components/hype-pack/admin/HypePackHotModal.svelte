<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="광적 관심폭발 상품 설정" {onclose}>
  <p class="placeholder-note">
    "최근 광적 관심폭발!" 섹션에 노출할 핫 상품 목록을 설정합니다.
  </p>
  <!-- TODO: 핫 상품 선택 + 순서 UI -->
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
