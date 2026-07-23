<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    title: string
    onclose: () => void
    children: Snippet
  }

  let { open, title, onclose, children }: Props = $props()
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="admin-modal-backdrop" onclick={onclose} role="presentation"></div>

  <aside
    class="admin-modal-panel"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div class="admin-modal-header">
      <span class="admin-modal-title">{title}</span>
      <button class="admin-modal-close" onclick={onclose} type="button" aria-label="닫기">✕</button>
    </div>
    <div class="admin-modal-body">
      {@render children()}
    </div>
  </aside>
{/if}

<style>
  .admin-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16, 11, 50, 0.3);
  }

  .admin-modal-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 420px;
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .admin-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    background: var(--cs-dark);
    flex-shrink: 0;
  }

  .admin-modal-title {
    color: var(--cs-white);
    font: var(--text-pc-title-16);
  }

  .admin-modal-close {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    padding: 4px 8px;
    min-height: 32px;
    transition: color 0.15s;
  }

  .admin-modal-close:hover {
    color: var(--cs-white);
  }

  .admin-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
</style>
