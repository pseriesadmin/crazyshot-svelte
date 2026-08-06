<script lang="ts">
  interface Delta {
    value:     number
    direction: 'up' | 'down' | 'flat'
  }

  interface Props {
    label:     string
    value:     string | number
    unit?:     string
    sub?:      string
    delta?:    Delta
    tone?:     'primary' | 'info' | 'neutral' | 'warn' | 'danger'
    size?:     'lg' | 'sm'
    progress?: number
  }

  let { label, value, unit = '', sub, delta, tone = 'neutral', size = 'lg', progress }: Props = $props()

  const deltaGlyph = $derived(
    delta?.direction === 'up' ? '▲' : delta?.direction === 'down' ? '▼' : '—'
  )

  // 숫자 값은 마운트 시 0 → 목표값 카운트업 애니메이션 (문자열 값은 그대로 표시)
  let animatedNum = $state(0)
  $effect(() => {
    if (typeof value !== 'number') return
    const target = value
    let raf: number
    const start = performance.now()
    const duration = 600
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      animatedNum = target * eased
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  const displayValue = $derived(
    typeof value === 'number' ? Math.round(animatedNum).toLocaleString('ko-KR') : value
  )
</script>

<div class="kpi-card kpi-card--{tone} kpi-card--{size}">
  <span class="kpi-label">{label}</span>
  <div class="kpi-value-row">
    <span class="kpi-value">{displayValue}</span>
    {#if unit}<span class="kpi-unit">{unit}</span>{/if}
  </div>
  {#if delta}
    <span class="kpi-delta kpi-delta--{delta.direction}">
      {deltaGlyph} {Math.abs(delta.value)}%
    </span>
  {/if}
  {#if progress !== undefined}
    <div class="kpi-progress-track">
      <div class="kpi-progress-bar" style:width="{Math.max(0, Math.min(100, progress))}%"></div>
    </div>
  {/if}
  {#if sub}
    <span class="kpi-sub">{sub}</span>
  {/if}
</div>

<style>
  .kpi-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 18px 20px 18px 22px;
    overflow: hidden;
    transition: transform 0.18s, box-shadow 0.18s;
  }
  .kpi-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 6px 16px rgba(16,11,50,0.10);
  }
  .kpi-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
  }
  .kpi-card--primary::before { background: var(--cs-purple); }
  .kpi-card--info::before    { background: var(--cs-info); }
  .kpi-card--neutral::before { background: var(--cs-purple-dark); }
  .kpi-card--warn::before    { background: var(--cs-warning); }
  .kpi-card--danger::before  { background: var(--cs-red-badge); }

  .kpi-card--sm { padding: 14px 16px 14px 18px; }

  .kpi-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .kpi-value-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .kpi-value {
    font: var(--text-pc-title-18);
    color: var(--cs-text);
    font-variant-numeric: tabular-nums;
  }
  .kpi-card--sm .kpi-value {
    font: var(--text-pc-body-14);
  }
  .kpi-card--info .kpi-value   { color: var(--cs-info); }
  .kpi-card--danger .kpi-value { color: var(--cs-red-badge); }
  .kpi-unit {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .kpi-delta {
    font: var(--text-pc-script-12);
    width: fit-content;
  }
  .kpi-delta--up   { color: var(--cs-text-success); }
  .kpi-delta--down { color: var(--cs-text-warning); }
  .kpi-delta--flat { color: var(--cs-text-light); }

  .kpi-progress-track {
    width: 100%;
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--cs-lilac);
    overflow: hidden;
  }
  .kpi-progress-bar {
    height: 100%;
    background: var(--cs-purple);
    border-radius: var(--radius-full);
  }

  .kpi-sub {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
</style>
