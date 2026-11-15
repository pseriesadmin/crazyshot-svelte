<script lang="ts">
  // 색상 선택 — 디자인 토큰 프리셋 칩 + HEX(#RRGGBB) 입력, <input type="color"> 는 보조.
  import { badgeTextColor, isHexColor } from '$lib/utils/badgeColor'

  interface Props {
    value?: string
    id?: string
    onchange?: (hex: string) => void
  }

  let { value = $bindable('#3B2F8A'), id = 'cms-color', onchange }: Props = $props()

  // app.css 디자인 토큰의 공식 값(데이터로 저장되므로 hex 로 보관)
  const PRESETS = ['#3B2F8A', '#100B32', '#201857', '#FF3535', '#CF0000', '#FF4500', '#666666', '#444444', '#ECEBF4']

  let draft = $state('')
  let editing = $state(false)
  const shown = $derived(editing ? draft : value)

  function commit(hex: string) {
    const up = hex.toUpperCase()
    if (!isHexColor(up)) return
    value = up
    onchange?.(up)
  }

  function onHexInput(e: Event) {
    editing = true
    const raw = (e.currentTarget as HTMLInputElement).value.replace(/[^#0-9A-Fa-f]/g, '').slice(0, 7)
    draft = raw.startsWith('#') ? raw : `#${raw}`
    if (isHexColor(draft)) commit(draft)
  }

  function onHexBlur() {
    editing = false
  }
</script>

<div class="cp-wrap">
  <div class="cp-presets">
    {#each PRESETS as c (c)}
      <button
        type="button"
        class="cp-swatch"
        class:active={value.toUpperCase() === c}
        style="background:{c}"
        aria-label={c}
        onclick={() => commit(c)}
      >{#if value.toUpperCase() === c}<span style="color:{badgeTextColor(c)}">✓</span>{/if}</button>
    {/each}
  </div>
  <div class="cp-row">
    <input
      {id}
      class="cp-hex"
      type="text"
      inputmode="text"
      maxlength="7"
      autocomplete="off"
      value={shown}
      oninput={onHexInput}
      onblur={onHexBlur}
      aria-label="HEX 색상"
    />
    <input class="cp-native" type="color" {value} oninput={(e) => commit((e.currentTarget as HTMLInputElement).value)} aria-label="색상 선택" />
  </div>
</div>

<style>
  .cp-wrap { display: flex; flex-direction: column; gap: 8px; }
  .cp-presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .cp-swatch {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    border: none; border-radius: var(--cms-radius-sm); cursor: pointer; font-size: 13px; font-weight: 700; padding: 0;
  }
  .cp-row { display: flex; align-items: center; gap: 8px; }
  .cp-hex {
    width: 112px;
    height: 36px;
    padding: 0 12px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    text-transform: uppercase;
  }
  .cp-hex:focus { outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }
  .cp-native { width: 36px; height: 36px; padding: 0; border: none; border-radius: var(--radius-sm); background: transparent; cursor: pointer; }
</style>
