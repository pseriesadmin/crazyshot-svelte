<script lang="ts" module>
  export interface KpiCardProps {
    label:     string
    value:     string | number
    unit?:     string
    sub?:      string
    delta?:    { value: number; direction: 'up' | 'down' | 'flat' }
    tone?:     'primary' | 'info' | 'neutral' | 'warn' | 'danger'
    size?:     'lg' | 'sm'
    progress?: number
  }
</script>

<script lang="ts">
  import CmsKpiCard from './CmsKpiCard.svelte'

  interface Props {
    cards:    KpiCardProps[]
    columns?: 3
  }

  let { cards, columns = 3 }: Props = $props()
</script>

<div class="kpi-grid" style:grid-template-columns="repeat({columns}, 1fr)">
  {#each cards as card (card.label)}
    <CmsKpiCard {...card} />
  {/each}
</div>

<style>
  .kpi-grid {
    display: grid;
    gap: 14px;
  }
</style>
