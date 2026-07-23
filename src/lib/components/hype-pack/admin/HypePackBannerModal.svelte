<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="어드 배너 설정" {onclose}>
  <p class="placeholder-note">
    PC 상단 어드 배너(Analog Pack 등) 이미지·링크·텍스트를 설정합니다.
  </p>
  <!-- TODO: 배너 이미지·카피·링크 입력 UI -->
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
