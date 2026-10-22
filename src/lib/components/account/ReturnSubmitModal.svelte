<script lang="ts">
  /**
   * 고객 반납정보 등록 화면(/account/rental/[id]/return-submit)을 PC에서 모바일 해상도 모달로 여는 프레임.
   * 이 화면은 모바일 전용이라 PC에서는 휴대폰 폭(390px) 창 안에 그대로 띄운다 — 같은 화면을 iframe 으로 불러 레이아웃이 모바일 기준으로 계산된다.
   * 화면 → 부모 통신(postMessage): { type: 'cs-return-submit', action: 'close' | 'goto', href? } — 같은 출처·이 iframe 에서 온 메시지만 처리한다.
   */
  import { onMount } from 'svelte'

  interface Props {
    /** 반납정보 등록 화면 주소(?modal=1 은 이 컴포넌트가 붙인다) */
    src: string
    onclose: () => void
    /** 화면이 다른 경로로 이동을 요청했을 때(예: 포인트 확인하기) */
    ongoto?: (href: string) => void
  }

  let { src, onclose, ongoto }: Props = $props()
  let frame = $state<HTMLIFrameElement | null>(null)
  let closeBtn = $state<HTMLButtonElement | null>(null)

  const frameSrc = $derived(src + (src.includes('?') ? '&' : '?') + 'modal=1')

  function onMessage(e: MessageEvent): void {
    if (e.origin !== window.location.origin) return
    if (!frame || e.source !== frame.contentWindow) return
    const d = e.data as { type?: string; action?: string; href?: string } | null
    if (!d || d.type !== 'cs-return-submit') return
    if (d.action === 'close') onclose()
    else if (d.action === 'goto' && typeof d.href === 'string' && d.href.startsWith('/') && !d.href.startsWith('//') && !d.href.includes('\\')) (ongoto ?? onclose)(d.href)
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose()
  }

  onMount(() => {
    const prev = document.body.style.overflow
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    closeBtn?.focus() // 열릴 때 닫기 버튼으로 포커스 이동(키보드·스크린리더 사용자가 모달 안에서 시작)
    return () => {
      document.body.style.overflow = prev
      opener?.focus() // 닫을 때 모달을 연 버튼으로 복귀
    }
  })
</script>

<svelte:window onmessage={onMessage} onkeydown={onKey} />

<div class="rs-backdrop" role="presentation"></div>
<div class="rs-wrap" role="dialog" aria-modal="true" aria-label="반납정보 등록">
  <div class="rs-frame">
    <iframe bind:this={frame} class="rs-iframe" src={frameSrc} title="반납정보 등록"></iframe>
  </div>
  <button type="button" class="rs-close" bind:this={closeBtn} onclick={onclose} aria-label="닫기">✕</button>
</div>

<style>
  .rs-backdrop { position: fixed; inset: 0; z-index: 9000; background: rgba(16, 11, 50, 0.6); }
  .rs-wrap { position: fixed; z-index: 9001; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 390px; max-width: 100vw; }
  .rs-frame { width: 100%; height: min(844px, 92dvh); border-radius: var(--radius-xl, 30px); overflow: hidden; background: var(--cs-lilac, #ecebf4); }
  .rs-iframe { width: 100%; height: 100%; border: none; display: block; }
  .rs-close { position: absolute; top: 0; left: calc(100% + 12px); width: 44px; height: 44px; border: none; border-radius: 50%; background: var(--cs-white-op20, rgba(255, 255, 255, 0.2)); color: var(--cs-white, #fff); font-size: 20px; line-height: 1; cursor: pointer; transition: background 0.15s; }
  .rs-close:hover { background: var(--cs-red-badge, #ff3535); }
</style>
