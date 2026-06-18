<script lang="ts">
  interface Props {
    canProceed: boolean;
    isLoading?: boolean;
    onContinue?: () => void;
    onReset?: () => void;
  }

  let {
    canProceed = false,
    isLoading = false,
    onContinue,
    onReset
  }: Props = $props();

  function handleContinue(): void {
    if (!canProceed || isLoading) return;
    onContinue?.();
  }

  function handleReset(): void {
    if (isLoading) return;
    onReset?.();
  }
</script>

<div class="button-zone">
  <button 
    class="btn btn-secondary"
    disabled={isLoading}
    onclick={handleReset}
    aria-label="장바구니 초기화"
  >
    다시 선택
  </button>

  <button 
    class="btn btn-primary"
    disabled={!canProceed || isLoading}
    onclick={handleContinue}
    aria-label="계속 진행"
  >
    {#if isLoading}
      <span class="loading-spinner"></span>
      처리 중...
    {:else}
      계속하기
    {/if}
  </button>
</div>

<style>
  .button-zone {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-3);
    padding: var(--spacing-4);
  }

  .btn {
    min-height: 48px;
    padding: var(--spacing-3) var(--spacing-4);
    border: none;
    border-radius: var(--radius-lg);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-2);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--color-primary);
    color: white;
  }

  .btn-primary:not(:disabled):hover {
    background: var(--color-primary-hover);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(255, 69, 0, 0.3);
  }

  .btn-secondary {
    background: var(--color-surface-alt);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:not(:disabled):hover {
    background: var(--color-border);
  }

  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 640px) {
    .button-zone {
      grid-template-columns: 1fr;
    }

    .btn {
      width: 100%;
    }
  }
</style>
