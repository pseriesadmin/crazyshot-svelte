<script lang="ts">
  import AdminModalShell from '$lib/components/common/admin/AdminModalShell.svelte'

  interface Props {
    open: boolean
    onclose: () => void
  }

  let { open, onclose }: Props = $props()
</script>

<AdminModalShell {open} title="FAQ 관리" {onclose}>
  <p class="placeholder-note">
    자주 묻는 질문(FAQ) 항목을 추가·수정·삭제합니다.<br />
    현재 하드코딩된 FAQ를 DB 관리로 전환합니다.
  </p>
  <!-- TODO: FAQ CRUD UI — 질문·답변 입력, 순서 변경, 탭 분류 -->
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
