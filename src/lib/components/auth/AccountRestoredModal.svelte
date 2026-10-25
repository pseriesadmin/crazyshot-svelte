<script lang="ts">
  // 탈퇴 유예 기간 안에 다시 로그인해 계정이 자동 복원됐을 때 한 번 보여주는 안내 모달 (2026-10-24)
  // 버튼은 front-uiux.md §5 보조 버튼(.cs-btn-secondary: 30px 반경, PC 50px / 모바일 44px)
  interface Props {
    open: boolean
    title?: string
    message?: string
    onclose: () => void
  }
  let {
    open,
    title = '계정이 복원되었어요',
    message = '탈퇴 신청이 취소되어 계정이 복원되었습니다. 기존 정보와 이용 내역을 그대로 사용하실 수 있어요.',
    onclose,
  }: Props = $props()
</script>

{#if open}
  <div class="arm-overlay" role="dialog" aria-modal="true" aria-labelledby="arm-title">
    <div class="arm-modal">
      <h2 id="arm-title" class="arm-title">{title}</h2>
      <p class="arm-message">{message}</p>
      <button type="button" class="cs-btn-secondary" onclick={onclose}>확인</button>
    </div>
  </div>
{/if}

<style>
  .arm-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0, 0, 0, 0.6);
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .arm-modal {
    width: 100%; max-width: 420px;
    background: var(--cs-white); border-radius: var(--radius-2xl);
    padding: 32px 24px 24px;
    display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
  }
  .arm-title { margin: 0; font: var(--text-m-title-18B); color: var(--cs-text); }
  .arm-message { margin: 0 0 12px; font: var(--text-m-script-14B); color: var(--cs-text-dark); line-height: 1.7; word-break: keep-all; }
  .cs-btn-secondary {
    display: inline-flex; align-items: center; justify-content: center;
    height: 44px; padding: 0 20px; min-width: 120px;
    background: var(--cs-purple); color: var(--cs-white);
    border: none; border-radius: var(--radius-xl);
    font: var(--text-m-body-16B); cursor: pointer; transition: background 0.15s;
  }
  .cs-btn-secondary:hover { background: var(--cs-purple-hover); }
  @media (min-width: 641px) {
    .arm-title { font: var(--text-pc-title-18); }
    .arm-message { font: var(--text-pc-body-14); }
    .cs-btn-secondary { height: 50px; padding: 0 30px; font: var(--text-pc-title-16); }
  }
</style>
