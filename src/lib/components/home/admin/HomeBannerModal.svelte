<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="히어로 배너 설정" {onclose}>
  <p class="placeholder-note">
    히어로 배너(PC/모바일) 이미지·링크를 설정합니다.<br />
    <code>banners</code> 테이블의 <code>hero_pc</code> · <code>hero_mobile</code> 슬롯을 관리합니다.
  </p>
  <!-- TODO: 배너 목록 + 이미지 업로드 + 링크 입력 UI -->
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
  code {
    font-family: monospace;
    background: var(--cs-purple-op10);
    padding: 1px 5px;
    border-radius: 4px;
  }
</style>
