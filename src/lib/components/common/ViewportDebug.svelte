<script lang="ts">
  /**
   * 뷰포트 진단 패널 — `?viewportdebug=1`을 붙였을 때만 +layout.svelte가 마운트한다(평소에는 코드가 실행되지 않음).
   * iOS Safari 상·하단 영역(주소창·툴바·안전 영역) 문제의 원인을 추측이 아니라 수치로 확정하기 위한 임시 도구다 — 동작·레이아웃을 바꾸지 않고 읽기만 한다.
   * 측정값: 뷰포트 높이(vh·dvh·svh·lvh·innerHeight·visualViewport·clientHeight), 안전 영역(상·하), position:fixed 상·하단 프로브의 실제 위치,
   *        viewport 메타, standalone 여부, html/body 배경색, 하단 탭바 상태, 스크롤 위치. 해결 후 제거해도 되는 파일이다.
   */
  import { onMount } from 'svelte'

  interface Snapshot {
    time: string
    ua: string
    standalone: string
    viewportMeta: string
    screen: string
    dpr: number
    innerWH: string
    clientWH: string
    visualViewport: string
    vh: string
    dvh: string
    svh: string
    lvh: string
    safeArea: string
    fixedTop: string
    fixedBottom: string
    scroll: string
    htmlBg: string
    bodyBg: string
    tabBar: string
  }

  let snap = $state<Snapshot | null>(null)
  let collapsed = $state(false)
  let copied = $state(false)
  let probesEl: HTMLDivElement | undefined
  let rafId = 0

  const px = (n: number | undefined): string => (n === undefined ? '-' : `${Math.round(n * 10) / 10}`)

  function measure(): void {
    if (!probesEl) return
    const q = (sel: string) => probesEl!.querySelector<HTMLElement>(sel)!
    const h = (sel: string) => q(sel).getBoundingClientRect().height
    const vv = window.visualViewport
    const safe = getComputedStyle(q('.p-safe'))
    const top = q('.p-fixed-top').getBoundingClientRect()
    const bottom = q('.p-fixed-bottom').getBoundingClientRect()
    const de = document.documentElement
    const tabBar = document.querySelector<HTMLElement>('.tab-bar')
    const tb = tabBar ? tabBar.getBoundingClientRect() : null
    const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
    snap = {
      time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
      ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90),
      standalone: `navigator.standalone=${String(navStandalone)} · display-mode:standalone=${window.matchMedia('(display-mode: standalone)').matches}`,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '(없음)',
      screen: `${screen.width}×${screen.height} (avail ${screen.availWidth}×${screen.availHeight})`,
      dpr: window.devicePixelRatio,
      innerWH: `${window.innerWidth}×${window.innerHeight}`,
      clientWH: `${de.clientWidth}×${de.clientHeight}`,
      visualViewport: vv
        ? `${px(vv.width)}×${px(vv.height)} · top ${px(vv.offsetTop)} · left ${px(vv.offsetLeft)} · scale ${px(vv.scale)}`
        : '(미지원)',
      vh: px(h('.p-vh')),
      dvh: px(h('.p-dvh')),
      svh: px(h('.p-svh')),
      lvh: px(h('.p-lvh')),
      safeArea: `top ${safe.paddingTop} · bottom ${safe.paddingBottom} · left ${safe.paddingLeft} · right ${safe.paddingRight}`,
      fixedTop: `top ${px(top.top)} (fixed top:0 의 실제 위치)`,
      fixedBottom: `bottom ${px(bottom.bottom)} (fixed bottom:0 의 실제 위치) → innerHeight와 차이 ${px(window.innerHeight - bottom.bottom)}`,
      scroll: `scrollY ${px(window.scrollY)} / max ${px(de.scrollHeight - window.innerHeight)} · docH ${px(de.scrollHeight)}`,
      htmlBg: getComputedStyle(de).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      tabBar: tb ? `display ${getComputedStyle(tabBar!).display} · top ${px(tb.top)} · bottom ${px(tb.bottom)} · h ${px(tb.height)}` : '(탭바 없음)',
    }
  }

  function schedule(): void {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(measure)
  }

  onMount(() => {
    measure()
    const vv = window.visualViewport
    window.addEventListener('resize', schedule, { passive: true })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('orientationchange', schedule)
    vv?.addEventListener('resize', schedule)
    vv?.addEventListener('scroll', schedule)
    // 툴바 접힘·펼침 전환이 끝난 뒤의 값도 잡도록 주기 갱신(가볍게 1초)
    const timer = setInterval(measure, 1000)
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('orientationchange', schedule)
      vv?.removeEventListener('resize', schedule)
      vv?.removeEventListener('scroll', schedule)
      clearInterval(timer)
      cancelAnimationFrame(rafId)
    }
  })

  async function copy(): Promise<void> {
    if (!snap) return
    const text = [`path ${location.pathname}${location.search}`, ...Object.entries(snap).map(([k, v]) => `${k}: ${v}`)].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      setTimeout(() => { copied = false }, 1500)
    } catch {
      copied = false
    }
  }

  const ROWS: Array<[keyof Snapshot, string]> = [
    ['innerWH', 'window.inner'],
    ['clientWH', 'html.client'],
    ['visualViewport', 'visualViewport'],
    ['screen', 'screen'],
    ['vh', '100vh'],
    ['dvh', '100dvh'],
    ['svh', '100svh'],
    ['lvh', '100lvh'],
    ['safeArea', 'safe-area'],
    ['fixedTop', 'fixed top'],
    ['fixedBottom', 'fixed bottom'],
    ['scroll', 'scroll'],
    ['tabBar', '탭바'],
    ['htmlBg', 'html bg'],
    ['bodyBg', 'body bg'],
    ['standalone', 'standalone'],
    ['viewportMeta', 'viewport 메타'],
    ['ua', 'UA'],
  ]
</script>

<!-- 측정용 프로브 — 화면에 보이지 않고(visibility:hidden) 레이아웃에 영향 없음(position:fixed, pointer-events:none) -->
<div class="probes" bind:this={probesEl} aria-hidden="true">
  <div class="p-vh"></div>
  <div class="p-dvh"></div>
  <div class="p-svh"></div>
  <div class="p-lvh"></div>
  <div class="p-safe"></div>
  <div class="p-fixed-top"></div>
  <div class="p-fixed-bottom"></div>
</div>

<div class="vd-panel" class:collapsed role="complementary" aria-label="뷰포트 진단">
  <div class="vd-head">
    <strong>뷰포트 진단 {snap?.time ?? ''}</strong>
    <span class="vd-actions">
      <button type="button" onclick={() => (collapsed = !collapsed)}>{collapsed ? '펼치기' : '접기'}</button>
      <button type="button" onclick={copy}>{copied ? '복사됨' : '복사'}</button>
    </span>
  </div>
  {#if !collapsed && snap}
    <dl class="vd-body">
      {#each ROWS as [key, label] (key)}
        <dt>{label}</dt>
        <dd>{snap[key]}</dd>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .probes { position: fixed; left: 0; top: 0; width: 0; height: 0; visibility: hidden; pointer-events: none; z-index: -1; }
  .p-vh   { position: fixed; left: 0; top: 0; width: 1px; height: 100vh; }
  .p-dvh  { position: fixed; left: 0; top: 0; width: 1px; height: 100dvh; }
  .p-svh  { position: fixed; left: 0; top: 0; width: 1px; height: 100svh; }
  .p-lvh  { position: fixed; left: 0; top: 0; width: 1px; height: 100lvh; }
  .p-safe {
    position: fixed; left: 0; top: 0; width: 1px; height: 1px;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }
  .p-fixed-top    { position: fixed; left: 0; top: 0; width: 1px; height: 1px; }
  .p-fixed-bottom { position: fixed; left: 0; bottom: 0; width: 1px; height: 1px; }

  .vd-panel {
    position: fixed;
    z-index: 2147483000;
    left: 6px;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    max-height: 70dvh;
    overflow: auto;
    padding: 8px 10px;
    border-radius: var(--radius-md, 15px);
    background: rgba(16, 11, 50, 0.9);
    color: #fff;
    font: 500 10.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .vd-panel.collapsed { top: auto; bottom: 120px; transform: none; }
  .vd-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .vd-actions { display: flex; gap: 4px; }
  .vd-actions button {
    min-height: 44px;
    padding: 0 12px;
    border: none;
    border-radius: var(--radius-md, 15px);
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    font: 700 11px/1 sans-serif;
  }
  .vd-body { margin: 6px 0 0; display: grid; grid-template-columns: 82px 1fr; gap: 2px 8px; }
  .vd-body dt { opacity: 0.65; }
  .vd-body dd { margin: 0; word-break: break-all; }
</style>
