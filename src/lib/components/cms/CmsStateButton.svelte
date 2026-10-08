<script lang="ts" generics="T extends string">
  // 단일 상태 버튼: 현재 상태를 글자와 색으로 보여 주고, 누르면 다음 상태로 넘어간다(꺼짐 → 관찰 → 켜짐 → 꺼짐 …).
  // 선택할 수 없는 단계(권한 없음 등)는 건너뛴다. 옵션 순서가 곧 순환 순서다.
  interface Option { value: T; label: string; disabled?: boolean; title?: string }
  interface Props {
    options: Option[]
    value: T
    onchange: (v: T) => void
    disabled?: boolean
    ariaLabel: string
  }
  let { options, value, onchange, disabled = false, ariaLabel }: Props = $props()

  const idx = $derived(Math.max(0, options.findIndex((o) => o.value === value)))
  const current = $derived(options[idx])
  // 현재 다음부터 한 바퀴 돌며 처음으로 선택 가능한 단계
  const next = $derived.by(() => {
    for (let i = 1; i < options.length; i++) {
      const o = options[(idx + i) % options.length]
      if (!o.disabled) return o
    }
    return null
  })
  const lockedHint = $derived(options.find((o) => o.disabled && o.title)?.title)
</script>

<button
  type="button"
  class="state-btn state-btn--{idx === 0 ? 'off' : idx === options.length - 1 ? 'on' : 'mid'}"
  aria-label="{ariaLabel}: 현재 {current?.label}"
  title={next ? `누르면 '${next.label}'(으)로 바뀝니다.${lockedHint ? ' ' + lockedHint : ''}` : lockedHint}
  disabled={disabled || !next}
  onclick={() => { if (next) onchange(next.value) }}
>{current?.label}</button>

<style>
  .state-btn { height: 32px; min-width: 72px; padding: 0 16px; border-radius: var(--cms-radius-xl, 30px); border: 1.5px solid var(--cs-lilac); background: var(--cs-white); color: var(--cs-text-mid); font: var(--text-pc-script-12); font-weight: 700; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
  /* 호버는 배경색 변경만(outline·border 변경 금지) */
  .state-btn:hover:not(:disabled) { background: var(--cs-lilac); }
  .state-btn--on:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .state-btn--mid:hover:not(:disabled) { background: var(--cs-lilac); filter: brightness(0.96); }
  .state-btn--mid { background: var(--cs-lilac); border-color: var(--cs-lilac); color: var(--cs-purple); }
  .state-btn--on { background: var(--cs-purple); border-color: var(--cs-purple); color: var(--cs-white); }
  /* 잠겨 있어도 현재 상태 색은 유지한다(cms-uiux.md §14) */
  .state-btn:disabled { cursor: default; }
</style>
