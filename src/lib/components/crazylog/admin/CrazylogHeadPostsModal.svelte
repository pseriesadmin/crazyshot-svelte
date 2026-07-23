<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="헤드 포스트 설정" {onclose}>
  <p class="placeholder-note">
    모바일 크레이지로그 홈 상단 캐러셀에 노출할 포스트를 선택합니다.
  </p>
  <!-- TODO: 포스트 검색 + 선택 UI -->
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
