<script lang="ts">
  interface BarItem {
    label:  string
    value:  number
    tone?:  'primary' | 'info' | 'neutral' | 'warn' | 'danger'
  }

  interface Props {
    items:  BarItem[]
    unit?:  string
    formatValue?: (n: number) => string
  }

  let { items, unit = '', formatValue }: Props = $props()

  const max = $derived(Math.max(1, ...items.map(i => i.value)))

  // 마운트 시 0 → 목표 너비로 채워지는 애니메이션
  let mounted = $state(false)
  $effect(() => {
    const t = setTimeout(() => { mounted = true }, 30)
    return () => clearTimeout(t)
  })

  function fmt(n: number): string {
    return formatValue ? formatValue(n) : n.toLocaleString('ko-KR')
  }

  function pct(value: number): number {
    return Math.max(2, (value / max) * 100)
  }
</script>

<div class="bars-wrap">
  {#each items as item, i (i)}
    <div class="bar-row bar-row--{item.tone ?? 'primary'}" title="{item.label}: {fmt(item.value)}{unit}">
      <span class="bar-label">{item.label}</span>
      <div class="bar-track">
        <div
          class="bar-fill"
          style:width="{mounted ? pct(item.value) : 0}%"
        ></div>
      </div>
      <span class="bar-value">{fmt(item.value)}{unit}</span>
    </div>
  {/each}
</div>

<style>
  .bars-wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 96px 1fr 88px;
    align-items: center;
    gap: 12px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    transition: background 0.15s;
    cursor: default;
  }
  .bar-row:hover {
    background: var(--bar-hover-bg);
  }
  .bar-row:hover .bar-value {
    color: var(--bar-color-current);
  }
  .bar-row:hover .bar-fill {
    filter: brightness(1.1);
  }
  .bar-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar-track {
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--cs-lilac);
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--bar-color-current);
    transition: width 0.7s cubic-bezier(0.34, 1.1, 0.64, 1), filter 0.15s;
  }
  .bar-value {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    transition: color 0.15s;
  }

  .bar-row--primary { --bar-color-current: var(--cs-purple);      --bar-hover-bg: rgba(59,47,138,0.06); }
  .bar-row--info     { --bar-color-current: var(--cs-info);        --bar-hover-bg: rgba(14,165,233,0.07); }
  .bar-row--neutral  { --bar-color-current: var(--cs-purple-dark); --bar-hover-bg: rgba(32,24,87,0.06); }
  .bar-row--warn     { --bar-color-current: var(--cs-warning);     --bar-hover-bg: rgba(245,158,11,0.08); }
  .bar-row--danger   { --bar-color-current: var(--cs-red-badge);   --bar-hover-bg: rgba(255,53,53,0.07); }
</style>
