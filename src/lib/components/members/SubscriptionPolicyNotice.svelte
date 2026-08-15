<script lang="ts">
  import type { SubscriptionPolicyItem } from '$lib/types/database'

  interface Props {
    items: SubscriptionPolicyItem[]
  }

  let { items }: Props = $props()
</script>

{#if items.length > 0}
  <section class="policy-notice" aria-label="정기구독 이용안내">
    <p class="policy-notice-title">정기구독 이용안내</p>
    <ul class="policy-notice-list">
      {#each items as item, i (item.id)}
        <li class="policy-notice-item">
          <span class="policy-notice-num">{i + 1}</span>
          <span class="policy-notice-text">{item.content}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .policy-notice {
    width: 100%;
    max-width: 1240px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 20px;
  }
  @media (min-width: 1024px) {
    .policy-notice { padding: 0; }
  }

  .policy-notice-title {
    font-family: var(--font-en-display);
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-dark);
    margin: 0;
  }

  .policy-notice-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 24px 24px;
    background: var(--cs-white);
    border-radius: 30px;
    list-style: none;
  }

  .policy-notice-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .policy-notice-num {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .policy-notice-text {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 500;
    color: var(--cs-text-mid);
    line-height: 1.6;
  }
</style>
