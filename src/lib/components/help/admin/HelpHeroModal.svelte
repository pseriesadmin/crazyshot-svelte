<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="히어로 설정" {onclose}>
  <p class="placeholder-note">
    도움말 페이지 히어로 배경 이미지·헤딩·서브타이틀을 설정합니다.
  </p>
  <!-- TODO: 이미지 업로드 + 텍스트 편집 UI -->
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
