<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="하이라이트 카드 설정" {onclose}>
  <p class="placeholder-note">
    홈 화면의 하이라이트 카드 4개 이미지·링크를 설정합니다.
  </p>
  <!-- TODO: 4개 카드 각각 이미지·링크 입력 UI -->
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
