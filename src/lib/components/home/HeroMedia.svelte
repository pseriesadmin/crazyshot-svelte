<script lang="ts">
  import { untrack } from 'svelte'
  import { isTrustedHeroMediaUrl, injectCsp } from '$lib/utils/heroBannerMedia'
  import { getSupabaseUrl } from '$lib/env/supabasePublic'

  // 홈 히어로 배너 — 영상(MP4)·키네틱 모션(HTML) 재생. 이미지는 페이지의 기존 <img> 를 그대로 쓴다.
  // HTML 은 sandbox="allow-scripts"(allow-same-origin 없음)로 격리해 로그인 정보·쿠키·페이지에 접근하지 못하고
  // 주소 이동·팝업·다운로드도 막는다. 문서 맨 앞에 CSP 를 붙여 외부 접속(방문자 IP·UA 전송, 외부 스크립트)도 막는다 —
  // 그래서 HTML 은 외부 CDN·폰트에 기대지 않는 자체 포함형(인라인 스크립트·스타일, data:/blob: 이미지)으로 만들어야 한다.
  // 한계: 메타 CSP 는 문서가 자기 창을 다른 주소로 이동시키는 것(meta refresh·location)까지는 막지 못한다 — 아래 load 감시로
  // 이동이 일어나면 즉시 창을 치우고, 업로드 전 사전 점검(hasMetaRefresh)으로 줄인다. 완전 차단은 사이트 전체 CSP frame-src 가 필요(별도 결정).
  // 저장소가 HTML 을 문서로 내려주지 않으므로 글을 읽어와 srcdoc 로 재생한다.
  // active=false(무한 순환용 복제 칸이 화면 밖일 때)·모션 줄이기 설정이면 재생하지 않는다.
  // current=이 칸이 지금 보이는(또는 막 들어오는) 칸인지 — current 가 되는 순간 처음부터 다시 재생하고(슬라이드가 도착했을 때 이미 모션이
  // 끝나 있는 문제 방지), 벗어난 뒤에는 슬라이드가 나가는 시간(0.5초)만 남겨 두었다가 치운다(화면 밖에서 돌지 않음).
  interface Props {
    kind: 'video' | 'html'
    src: string
    alt?: string
    active?: boolean
    current?: boolean
    /** 영상을 끝나도 반복할지 — 배너가 1장뿐일 때만 true(여러 장이면 끝난 뒤 자동 슬라이드가 넘어간다) */
    loop?: boolean
    /** 재생 중임을 알린다(+1 시작 / -1 끝) — 홈이 자동 슬라이드를 모션이 끝날 때까지 기다리게 한다 */
    onhold?: (delta: 1 | -1) => void
  }
  let { kind, src, alt = '', active = true, current = true, loop = false, onhold }: Props = $props()

  // 재생 시간 보장: 현재 칸의 모션이 끝나야(HTML=끝 신호 postMessage {type:'crazyshot-hero-intro', status:'end'}, 영상=ended)
  // 자동 슬라이드가 넘어간다. 신호가 없거나 로드에 실패해도 무한정 멈추지 않도록 최대 대기 시간을 둔다.
  const HTML_MAX_MS = 12000
  const VIDEO_MAX_MS = 30000

  const CSP =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"

  const trusted = $derived(isTrustedHeroMediaUrl(src, getSupabaseUrl()))

  let reduceMotion = $state(false)
  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduceMotion = mq.matches
    const on = () => { reduceMotion = mq.matches }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  })

  const LINGER_MS = 500   // 슬라이드 전환(0.4초)이 끝나 화면에서 완전히 사라질 때까지 유지
  let playKey = $state(0)
  let lingering = $state(false)
  let prevCurrent = false
  let lingerTimer: ReturnType<typeof setTimeout> | undefined
  const visible = $derived(current || lingering)

  $effect(() => {
    const cur = current
    if (cur && !prevCurrent) {
      clearTimeout(lingerTimer)
      lingering = false
      loads = 0
      navigated = false
      playKey += 1          // 처음부터 다시 재생(iframe·video 를 새로 만든다)
    } else if (!cur && prevCurrent) {
      lingering = true
      clearTimeout(lingerTimer)
      lingerTimer = setTimeout(() => { lingering = false }, LINGER_MS)
    }
    prevCurrent = cur
  })
  $effect(() => () => clearTimeout(lingerTimer))

  let frameEl = $state<HTMLIFrameElement | null>(null)
  let releaseHold: (() => void) | null = null

  $effect(() => {
    if (!(trusted && active && !reduceMotion && current)) return
    void playKey   // 처음부터 다시 재생되면 대기도 새로 시작
    let holding = true
    untrack(() => onhold?.(1))
    const release = () => { if (holding) { holding = false; untrack(() => onhold?.(-1)) } }
    releaseHold = release
    const timer = setTimeout(release, kind === 'html' ? HTML_MAX_MS : VIDEO_MAX_MS)
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; status?: string } | null
      if (kind === 'html' && frameEl && e.source === frameEl.contentWindow && d?.type === 'crazyshot-hero-intro' && d.status === 'end') release()
    }
    window.addEventListener('message', onMessage)
    return () => { clearTimeout(timer); window.removeEventListener('message', onMessage); release(); releaseHold = null }
  })

  let htmlDoc = $state<string | null>(null)
  let loads = 0
  let navigated = $state(false)

  // srcdoc 첫 로드 뒤 또 로드되면 문서가 스스로 다른 곳으로 이동한 것 — 창을 치운다
  function onFrameLoad(): void {
    loads += 1
    if (loads > 1) navigated = true
  }

  $effect(() => {
    if (kind !== 'html' || !trusted || !active || reduceMotion) { htmlDoc = null; return }
    htmlDoc = null
    loads = 0
    navigated = false
    const ctrl = new AbortController()
    fetch(src, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { htmlDoc = injectCsp(t, CSP) })
      .catch(() => { /* 불러오기 실패 시 빈 배경 유지 */ })
    return () => ctrl.abort()
  })
</script>

{#if trusted && active && !reduceMotion && visible}
  {#key playKey}
  {#if kind === 'video'}
    <video class="hero-media" src={src} autoplay muted {loop} playsinline preload="auto" aria-label={alt} onended={() => releaseHold?.()} onerror={() => releaseHold?.()}></video>
  {:else if htmlDoc !== null && !navigated}
    <iframe
      bind:this={frameEl}
      class="hero-media"
      title={alt || '히어로 배너'}
      sandbox="allow-scripts"
      srcdoc={htmlDoc}
      referrerpolicy="no-referrer"
      allow=""
      tabindex="-1"
      scrolling="no"
      onload={onFrameLoad}
    ></iframe>
  {/if}
  {/key}
{/if}

<style>
  .hero-media {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    object-fit: cover;
    object-position: top;
    /* 드래그·클릭은 슬라이드(스와이프)와 링크가 받도록 한다 */
    pointer-events: none;
  }
</style>
