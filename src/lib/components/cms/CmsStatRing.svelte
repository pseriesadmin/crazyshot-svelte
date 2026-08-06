<script lang="ts">
  interface Props {
    value:     number   // 0~100
    label:     string
    centerText?: string
    tone?:     'primary' | 'info' | 'neutral' | 'warn' | 'danger'
    size?:     number
  }

  let { value, label, centerText, tone = 'primary', size = 128 }: Props = $props()

  const clamped = $derived(Math.max(0, Math.min(100, value)))
  const thickness = $derived(size >= 110 ? 12 : 9)
  const radius = $derived((size - thickness) / 2)
  const circumference = $derived(2 * Math.PI * radius)

  // 카운트업 애니메이션 (마운트 시 0 → 목표값)
  let animated = $state(0)
  $effect(() => {
    const target = clamped
    let raf: number
    const start = performance.now()
    const duration = 700
    const from = 0
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      animated = from + (target - from) * eased
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  const offset = $derived(circumference * (1 - animated / 100))
  const display = $derived(centerText ?? `${Math.round(animated)}%`)
</script>

<div class="ring-wrap ring-wrap--{tone}">
  <svg width={size} height={size} viewBox="0 0 {size} {size}" class="ring-svg">
    <circle
      cx={size / 2} cy={size / 2} r={radius}
      fill="none" stroke="var(--cs-lilac)" stroke-width={thickness}
    />
    <circle
      cx={size / 2} cy={size / 2} r={radius}
      fill="none" stroke="var(--ring-color-{tone})" stroke-width={thickness}
      stroke-linecap="round"
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      transform="rotate(-90 {size / 2} {size / 2})"
      class="ring-arc"
    />
  </svg>
  <div class="ring-center" style:width="{size}px" style:height="{size}px">
    <span class="ring-value">{display}</span>
  </div>
  <span class="ring-label">{label}</span>
</div>

<style>
  .ring-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    position: relative;
    padding: 8px;
    border-radius: var(--cms-radius-md);
    transition: background 0.2s, transform 0.2s;
  }
  .ring-wrap:hover {
    background: var(--ring-hover-bg);
    transform: translateY(-2px);
  }
  .ring-svg { display: block; filter: drop-shadow(0 0 0 transparent); transition: filter 0.2s; }
  .ring-wrap:hover .ring-svg {
    filter: drop-shadow(0 2px 8px var(--ring-glow));
  }
  .ring-arc {
    transition: stroke-dashoffset 0.15s linear;
  }
  .ring-center {
    position: absolute;
    top: 8px; left: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ring-value {
    font: var(--text-pc-htitle-25);
    color: var(--cs-text);
    font-variant-numeric: tabular-nums;
  }
  .ring-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .ring-wrap--primary { --ring-color-current: var(--cs-purple);      --ring-hover-bg: rgba(59,47,138,0.06);  --ring-glow: rgba(59,47,138,0.35); }
  .ring-wrap--info     { --ring-color-current: var(--cs-info);        --ring-hover-bg: rgba(14,165,233,0.07); --ring-glow: rgba(14,165,233,0.35); }
  .ring-wrap--neutral  { --ring-color-current: var(--cs-purple-dark); --ring-hover-bg: rgba(32,24,87,0.06);   --ring-glow: rgba(32,24,87,0.3); }
  .ring-wrap--warn     { --ring-color-current: var(--cs-warning);     --ring-hover-bg: rgba(245,158,11,0.08); --ring-glow: rgba(245,158,11,0.35); }
  .ring-wrap--danger   { --ring-color-current: var(--cs-red-badge);   --ring-hover-bg: rgba(255,53,53,0.07);  --ring-glow: rgba(255,53,53,0.35); }

  .ring-wrap {
    --ring-color-primary: var(--cs-purple);
    --ring-color-info:    var(--cs-info);
    --ring-color-neutral: var(--cs-purple-dark);
    --ring-color-warn:    var(--cs-warning);
    --ring-color-danger:  var(--cs-red-badge);
  }
</style>
