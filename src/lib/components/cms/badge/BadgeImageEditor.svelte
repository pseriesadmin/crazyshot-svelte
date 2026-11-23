<script lang="ts">
  // 배지 편집기(크레이지샷 배지 편집기 v1.0) — 모양·문구·색·글자 크기/위치를 고쳐 PNG 로 만든 뒤 onapply 로 넘긴다.
  // 저장은 부모(BadgeTemplatePanel)가 기존 이미지 업로드 경로(/api/cms/badges/icon)로 처리한다 — 서버 검증은 그대로다.
  import { onMount } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import CmsColorPicker from '$lib/components/cms/CmsColorPicker.svelte'
  import { BadgeLib } from '$lib/vendor/badgeLib.js'
  import type { BadgeEditorParams } from '$lib/vendor/badgeLib.js'
  import { MAX_BADGE_SVG_BYTES } from '$lib/utils/badgeSvgUrl'
  import { isHexColor } from '$lib/utils/badgeColor'

  interface Props {
    /** 만든 PNG 를 부모가 올린다(성공·실패 안내는 부모가 하고, 성공 여부만 돌려준다) */
    onapply: (file: File) => Promise<boolean>
    busy?: boolean
    /** 위쪽 '이름' 입력값 — 입력하면 메인 글자에 그대로 반영된다(메인 글자는 이후 따로 고칠 수 있다) */
    name?: string
    /** 만든 이미지를 올린 직후 배지 저장까지 이어서 한다(부모의 저장) */
    onsave?: () => Promise<void>
    /** 저장 중이거나 이름이 없을 때 true */
    saveDisabled?: boolean
    /** true 이면(이미 저장된 배지의 이미지를 바꾸는 경우) 첫 클릭은 경고 토스트만 띄우고, 한 번 더 눌러야 저장한다 */
    confirmOverwrite?: boolean
  }

  let { onapply, busy = false, name = '', onsave, saveDisabled = false, confirmOverwrite = false }: Props = $props()

  const FONT_URL = '/fonts/CrazyBadgeKR.woff2'
  const MAX_PX = 1024
  const SLIDER_DEFAULT = { scale: 1, sm: 1, mm: 1, sb: 1, dx: 0, dy: 0, tr: 0 }
  type SliderKey = keyof typeof SLIDER_DEFAULT

  const SLIDERS: { key: SliderKey; label: string; min: number; max: number; step: number }[] = [
    { key: 'scale', label: '전체 크기', min: 0.5, max: 1.8, step: 0.05 },
    { key: 'sm', label: '작은 글자', min: 0.5, max: 2, step: 0.05 },
    { key: 'mm', label: '메인 글자', min: 0.5, max: 2, step: 0.05 },
    { key: 'sb', label: '아래 글자', min: 0.5, max: 2, step: 0.05 },
    { key: 'dx', label: '좌우 위치', min: -80, max: 80, step: 1 },
    { key: 'dy', label: '상하 위치', min: -80, max: 80, step: 1 },
    { key: 'tr', label: '기울기', min: -30, max: 30, step: 1 },
  ]

  const COLOR_SETS = [
    { name: '딥 네이비 + 라벤더', c1: '#100B32', c2: '#C1BBEC', tc: '#FFFFFF' },
    { name: '레드 + 라벤더', c1: '#CF0000', c2: '#C1BBEC', tc: '#FFFFFF' },
    { name: '퍼플 + 라벤더', c1: '#A32994', c2: '#C1BBEC', tc: '#FFFFFF' },
    { name: '라벤더 + 딥 네이비', c1: '#C1BBEC', c2: '#100B32', tc: '#100B32' },
  ]

  const STAGE_BGS = [
    { key: 'checker', label: '투명 격자' },
    { key: 'white', label: '흰색' },
    { key: 'dark', label: '어두운 배경' },
  ]

  const tplKeys = Object.keys(BadgeLib.TPL)

  // 시작값: 기본 모음의 첫 항목(NEW 가격표)
  const first = BadgeLib.DEFAULTS[0].v
  let ed = $state<BadgeEditorParams>({ ...first })
  let stageBg = $state('checker')
  let making = $state(false)
  let colorKey = $state(0) // 색상 세트·기본값 적용 시 CmsColorPicker 재마운트(내부 입력값 동기화)

  $effect(() => {
    const n = name.trim()
    if (n) ed.main = n.slice(0, 20)
  })

  function colorOf(v: string, fallback: string): string {
    return isHexColor(v) ? v : fallback
  }
  // 미리보기 SVG — 글자는 편집기 안에서 이스케이프되고, 색은 #RRGGBB 로 한정한다
  const safe = $derived<BadgeEditorParams>({
    ...ed,
    c1: colorOf(ed.c1, '#25314A'),
    c2: colorOf(ed.c2, '#E8B84A'),
    tc: colorOf(ed.tc, '#FFFFFF'),
  })
  const stageSvg = $derived(BadgeLib.build(safe, { id: 'm', scale: 1.4 }))

  function sliderVal(k: SliderKey): number {
    const v = ed[k]
    return v == null ? SLIDER_DEFAULT[k] : v
  }
  function setSlider(k: SliderKey, v: number) {
    ed[k] = v
  }
  function resetKeys(keys: SliderKey[]) {
    for (const k of keys) ed[k] = SLIDER_DEFAULT[k]
  }
  function applySet(s: { c1: string; c2: string; tc: string }) {
    ed.c1 = s.c1
    ed.c2 = s.c2
    ed.tc = s.tc
    colorKey += 1
  }
  function defaultColors(): { c1: string; c2: string; tc: string } {
    const hit = BadgeLib.DEFAULTS.find((d) => d.v.tpl === ed.tpl)
    return hit ? { c1: hit.v.c1, c2: hit.v.c2, tc: hit.v.tc } : { c1: '#25314A', c2: '#E8B84A', tc: '#FFFFFF' }
  }

  onMount(() => {
    // 미리보기 글자체 — 편집기와 같은 서체(자체 보관)를 페이지에 등록
    if (typeof FontFace === 'undefined') return
    const face = new FontFace('CrazyBadgeKR', `url(${FONT_URL})`, { weight: '900' })
    face.load().then(
      (f) => document.fonts.add(f),
      () => {
        // 서체를 못 불러오면 대체 글꼴로 보인다(만들기 단계에서 다시 시도)
      }
    )
  })

  // ── 미리보기에서 글자 끌어 옮기기(편집기와 동일)
  let stageEl = $state<HTMLDivElement | null>(null)
  let drag: { x: number; y: number; dx: number; dy: number } | null = null

  function svgPoint(ev: PointerEvent): { x: number; y: number } | null {
    const svg = stageEl?.querySelector('svg')
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const q = svg.createSVGPoint()
    q.x = ev.clientX
    q.y = ev.clientY
    const p = q.matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }
  function clamp80(n: number): number {
    return Math.max(-80, Math.min(80, Math.round(n)))
  }
  function onStageDown(ev: PointerEvent) {
    const t = ev.target as Element | null
    if (!t?.closest('text')) return
    const p = svgPoint(ev)
    if (!p) return
    drag = { x: p.x, y: p.y, dx: ed.dx ?? 0, dy: ed.dy ?? 0 }
    try {
      stageEl?.setPointerCapture(ev.pointerId)
    } catch {
      // 포인터 캡처 실패는 끌기 동작에 영향 없음
    }
    ev.preventDefault()
  }
  function onStageMove(ev: PointerEvent) {
    if (!drag) return
    const p = svgPoint(ev)
    if (!p) return
    ed.dx = clamp80(drag.dx + p.x - drag.x)
    ed.dy = clamp80(drag.dy + p.y - drag.y)
  }
  function onStageEnd() {
    drag = null
  }

  // ── PNG 만들기 — 서체를 SVG 안에 심어 그린다(편집기 PNG 저장과 같은 방식)
  let fontCssCache: string | null = null
  async function loadFontCss(): Promise<string> {
    if (fontCssCache) return fontCssCache
    const res = await fetch(FONT_URL)
    if (!res.ok) throw new Error('font')
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    fontCssCache = `@font-face{font-family:'CrazyBadgeKR';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');font-weight:900;font-style:normal;font-display:block}`
    return fontCssCache
  }

  function renderPng(svg: string, w: number, h: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return reject(new Error('canvas'))
        ctx.drawImage(img, 0, 0, w, h)
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png')
      }
      img.onerror = () => reject(new Error('img'))
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
  }

  /** PNG 를 만들어 올린다. 성공하면 true */
  async function apply(): Promise<boolean> {
    if (making || busy) return false
    if (ed.main.trim() === '' && ed.small.trim() === '' && ed.sub.trim() === '') {
      csToast.error('문구를 입력해 주세요')
      return false
    }
    making = true
    try {
      const fontCss = await loadFontCss()
      const base = BadgeLib.build(safe, { id: 'p', scale: 1 })
      const m = base.match(/width="(\d+)" height="(\d+)"/)
      const w1 = m ? Number(m[1]) : 240
      const h1 = m ? Number(m[2]) : 240
      // 선명하게 2배로 시작하되 한도(1024px·200KB)를 넘으면 단계적으로 줄인다
      let k = Math.min(2, MAX_PX / Math.max(w1, h1))
      let blob: Blob | null = null
      for (let i = 0; i < 4; i++) {
        const svg = BadgeLib.build(safe, { id: 'p', scale: k, fontCss })
        const mm = svg.match(/width="(\d+)" height="(\d+)"/)
        const w = mm ? Number(mm[1]) : Math.round(w1 * k)
        const h = mm ? Number(mm[2]) : Math.round(h1 * k)
        const b = await renderPng(svg, w, h)
        if (b.size <= MAX_BADGE_SVG_BYTES) {
          blob = b
          break
        }
        k *= 0.75
      }
      if (!blob) {
        csToast.error('이미지가 너무 커요. 전체 크기를 줄여 주세요')
        return false
      }
      // 올리기에 실패하면 false — 저장을 이어가지 않는다(안내 토스트는 부모가 이미 띄움)
      return await onapply(new File([blob], 'badge.png', { type: 'image/png' }))
    } catch {
      csToast.error('배지 이미지를 만들지 못했어요')
      return false
    } finally {
      making = false
    }
  }

  // 덮어쓰기 안전장치(삭제 안전 토스트와 같은 2단계 확인) — 1차 클릭: 경고 토스트 + 무장, 5초 안에 2차 클릭: 저장
  let armed = $state(false)
  let armTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => () => {
    if (armTimer) clearTimeout(armTimer)
  })

  async function applyAndSave() {
    if (!onsave) return
    if (confirmOverwrite && !armed) {
      armed = true
      csToast.warning('기존 배지 이미지가 지금 편집한 모양으로 바뀝니다. 한번 더 누르면 저장됩니다.', { id: 'badge-overwrite' })
      armTimer = setTimeout(() => (armed = false), 5000)
      return
    }
    if (armTimer) clearTimeout(armTimer)
    armed = false
    if (await apply()) await onsave()
  }
</script>

<div class="be">
  <div class="be-row be-top">
    <span class="be-label">모양</span>
    <div class="tpl-grid">
      {#each tplKeys as k (k)}
        <button type="button" class="tpl-tile" class:active={ed.tpl === k} title={BadgeLib.TPL[k].name} aria-label={BadgeLib.TPL[k].name} onclick={() => (ed.tpl = k)}>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html BadgeLib.build({ ...safe, tpl: k }, { id: `t${k}` })}
        </button>
      {/each}
    </div>
  </div>

  <div class="be-row">
    <label class="be-label" for="be-small">작은 글자</label>
    <input id="be-small" class="il-input" maxlength="12" bind:value={ed.small} autocomplete="off" />
  </div>
  <div class="be-row">
    <label class="be-label" for="be-main">메인 글자</label>
    <textarea id="be-main" class="il-input il-area" rows="2" maxlength="20" bind:value={ed.main}></textarea>
  </div>
  <div class="be-row">
    <label class="be-label" for="be-sub">아래 글자</label>
    <input id="be-sub" class="il-input" maxlength="12" bind:value={ed.sub} autocomplete="off" />
  </div>

  <div class="be-row be-top">
    <span class="be-label">색상</span>
    <div class="be-col">
      <div class="color-line"><span class="sub-label">본체</span>{#key colorKey}<CmsColorPicker bind:value={ed.c1} id="be-c1" />{/key}</div>
      <div class="color-line"><span class="sub-label">포인트</span>{#key colorKey}<CmsColorPicker bind:value={ed.c2} id="be-c2" />{/key}</div>
      <div class="color-line"><span class="sub-label">글자</span>{#key colorKey}<CmsColorPicker bind:value={ed.tc} id="be-tc" />{/key}</div>
      <div class="pill-row">
        {#each COLOR_SETS as s (s.name)}
          <button type="button" class="mini-btn" onclick={() => applySet(s)}>{s.name}</button>
        {/each}
        <button type="button" class="mini-btn" onclick={() => applySet(defaultColors())}>색상 기본값</button>
        <button type="button" class="mini-btn" class:on={ed.fx !== false} onclick={() => (ed.fx = ed.fx === false)}>그림자·그라데이션 {ed.fx === false ? '끔' : '켬'}</button>
      </div>
    </div>
  </div>

  <div class="be-row be-top">
    <span class="be-label">글자 조절</span>
    <div class="be-col">
      {#each SLIDERS as s (s.key)}
        <div class="sl">
          <label for={`be-sl-${s.key}`}>{s.label}</label>
          <input id={`be-sl-${s.key}`} type="range" min={s.min} max={s.max} step={s.step} value={sliderVal(s.key)} oninput={(e) => setSlider(s.key, parseFloat(e.currentTarget.value))} />
          <b>{Math.round(sliderVal(s.key) * 100) / 100}</b>
        </div>
      {/each}
      <div class="pill-row">
        <button type="button" class="mini-btn" onclick={() => resetKeys(['scale', 'sm', 'mm', 'sb'])}>글자 크기 초기화</button>
        <button type="button" class="mini-btn" onclick={() => resetKeys(['dx', 'dy', 'tr'])}>글자 위치 초기화</button>
      </div>
    </div>
  </div>

  <div class="be-row be-top">
    <span class="be-label">편집 미리보기</span>
    <div class="be-col">
      <div class="pill-row">
        {#each STAGE_BGS as b (b.key)}
          <button type="button" class="mini-btn" class:on={stageBg === b.key} onclick={() => (stageBg = b.key)}>{b.label}</button>
        {/each}
      </div>
      <!-- 글자를 끌어서 옮길 수 있다 -->
      <div
        class="stage bg-{stageBg}"
        bind:this={stageEl}
        role="presentation"
        onpointerdown={onStageDown}
        onpointermove={onStageMove}
        onpointerup={onStageEnd}
        onpointercancel={onStageEnd}
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html stageSvg}
      </div>
      <div class="pill-row save-row">
        {#if onsave}
          <button type="button" class="btn-apply" disabled={making || busy || saveDisabled} onclick={applyAndSave}>{making || busy ? '저장 중…' : armed ? '한번 더 누르면 저장됩니다' : '저장'}</button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .be { display: flex; flex-direction: column; }
  .be-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--cs-surface-gray); }
  .be-row:last-child { border-bottom: none; }
  .be-top { align-items: flex-start; padding-top: 10px; }
  .be-label { flex: 0 0 90px; font: var(--text-pc-script-12); color: var(--cs-text-light); padding-top: 1px; }
  .be-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .sub-label { display: inline-block; width: 40px; font: var(--text-pc-script-12); color: var(--cs-text-light); vertical-align: top; padding-top: 6px; }
  .color-line { display: flex; align-items: flex-start; gap: 8px; }

  .il-input {
    flex: 1; width: 100%; background: transparent; border: none; border-radius: var(--cms-radius-sm);
    padding: 3px 8px; font: var(--text-pc-body-14); color: var(--cs-text);
    transition: background 0.12s, outline 0.12s; min-height: 32px;
  }
  .il-area { resize: none; padding-top: 6px; }
  .il-input:hover { background: rgba(59,47,138,0.04); }
  .il-input:focus { background: var(--cs-surface-gray); outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }

  /* 모양 선택 — 현재 문구·색으로 그린 썸네일. 선택은 면 색(보더 없음) */
  .tpl-grid { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
  .tpl-tile {
    height: 84px; padding: 6px; border: none; border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray); display: flex; align-items: center; justify-content: center; cursor: pointer;
    transition: background 0.15s;
  }
  .tpl-tile:hover { background: var(--cs-lilac); }
  .tpl-tile.active { background: var(--cs-purple-op10); }
  .tpl-tile :global(svg) { width: auto; height: auto; max-width: 100%; max-height: 72px; }

  .pill-row { display: flex; flex-wrap: wrap; gap: 6px; }
  /* 초소형 라운드 버튼형 (cms-uiux.md §0-10-C) */
  .mini-btn {
    display: inline-flex; align-items: center; padding: 5px 10px; border: none; border-radius: var(--radius-full);
    background: var(--cs-surface-gray); color: var(--cs-text-mid); font-size: 11px; font-weight: 600; cursor: pointer;
    white-space: nowrap; transition: background 0.15s, color 0.15s;
  }
  .mini-btn:hover { background: var(--cs-text-mid); color: var(--cs-white); }
  .mini-btn.on { background: var(--cs-purple); color: var(--cs-white); }
  /* 저장 줄 — 오른쪽 정렬, 위 영역과의 간격 3배(8px → 24px) */
  .save-row { justify-content: flex-end; margin-top: 16px; }
  /* 저장 버튼 — 헤더의 btn-save-inline 과 같은 값(cms-uiux.md §0-10-D): 비활성은 윤곽선, 활성은 퍼플 면 */
  .btn-apply {
    padding: 5px 14px; border: 1.5px solid var(--cs-purple); border-radius: var(--radius-sm);
    background: var(--cs-purple); color: var(--cs-white); font: var(--text-pc-script-12);
    cursor: pointer; min-height: 32px; transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .btn-apply:hover:not(:disabled) { background: var(--cs-purple-hover); border-color: var(--cs-purple-hover); }
  .btn-apply:disabled { border-color: var(--cs-border); background: transparent; color: var(--cs-text-light); cursor: not-allowed; }

  .sl { display: grid; grid-template-columns: 70px 1fr 40px; gap: 8px; align-items: center; font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .sl label { color: var(--cs-text-light); }
  .sl b { text-align: right; font-weight: 600; color: var(--cs-text); }
  .sl input[type='range'] { width: 100%; accent-color: var(--cs-purple); }

  .stage { min-height: 240px; border-radius: var(--cms-radius-sm); display: flex; align-items: center; justify-content: center; padding: 20px; overflow: auto; touch-action: none; }
  .stage :global(svg) { max-width: 100%; height: auto; }
  .stage :global(text) { cursor: move; }
  .bg-checker { background: repeating-conic-gradient(var(--cs-lilac) 0 25%, var(--cs-white) 0 50%) 0 0 / 20px 20px; }
  .bg-white { background: var(--cs-white); }
  .bg-dark { background: var(--cs-dark); }
</style>
