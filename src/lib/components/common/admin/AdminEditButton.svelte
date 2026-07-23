<script lang="ts">
  import { isCmsMode } from '$lib/stores/adminSettings'

  interface Props {
    label: string
    icon?: string
    variant?: 'float' | 'inline' | 'empty-state'
    onclick: () => void
  }

  let { label, icon = '✦', variant = 'float', onclick }: Props = $props()
</script>

{#if $isCmsMode}
  <button
    class="admin-edit-btn admin-edit-btn--{variant}"
    {onclick}
    type="button"
  >
    <span class="admin-edit-btn__icon">{icon}</span>
    <span class="admin-edit-btn__label">{label}</span>
  </button>
{/if}

<style>
  .admin-edit-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 6px 12px;
    border: none;
    cursor: pointer;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    border-radius: var(--radius-sm);
    transition: background 0.12s;
    white-space: nowrap;
    z-index: 20;
  }

  .admin-edit-btn--float,
  .admin-edit-btn--inline {
    background: rgba(16, 11, 50, 0.75);
    color: var(--cs-white);
  }

  .admin-edit-btn--float:hover,
  .admin-edit-btn--inline:hover {
    background: rgba(16, 11, 50, 0.92);
  }

  .admin-edit-btn--float {
    position: absolute;
    top: 10px;
    right: 10px;
  }

  .admin-edit-btn--empty-state {
    background: rgba(59, 47, 138, 0.12);
    color: var(--cs-purple);
    border: 2px dashed var(--cs-purple);
    border-radius: var(--radius-xl);
  }

  .admin-edit-btn__icon {
    font-size: 13px;
  }
</style>
