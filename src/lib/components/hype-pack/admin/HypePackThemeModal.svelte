<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="팩 테마목록 설정" {onclose}>
  <p class="placeholder-note">
    Idol Pack · Creator Pack · Activity Pack 등 팩 테마 카드의 이름·이미지·순서를 설정합니다.
  </p>
  <!-- TODO: 팩 테마 목록 편집 UI -->
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
