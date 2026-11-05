<script lang="ts">
  // PdfModal — PDF 1개를 가운데 창(모달)으로 보여 주는 단순 뷰어 (상품설명서용, CMS·고객 화면 공용)
  // 구성: 파일 이름 + 닫기(✕) 머리줄, 본문은 PdfViewer 그대로(쪽 목록·쪽 이동·배율·회전·내려받기·인쇄).
  // 닫기: ✕ · 바깥 어두운 영역 클릭 · Esc. 계약서 뷰어·이미지 뷰어(MediaViewer)와는 별개다.
  import { onMount } from 'svelte'
  import PdfViewer from '$lib/components/common/PdfViewer.svelte'

  interface Props {
    /** PDF 주소(공개 주소) */
    src: string
    /** 머리줄에 표시할 파일 이름 */
    title: string
    /** 내려받기 주소(없으면 내려받기 버튼 숨김) */
    downloadUrl?: string
    downloadFilename?: string
    onclose: () => void
    /** 단순 뷰어 — 쪽 이동·내려받기만 남긴다(고객 화면). 기본 꺼짐(CMS는 전체 도구) */
    simple?: boolean
  }

  let { src, title, downloadUrl, downloadFilename, onclose, simple = false }: Props = $props()

  let closeBtn = $state<HTMLButtonElement | null>(null)

  // 단순 뷰어(고객 화면) 내려받기 주소 — 저장소가 다른 출처라 <a download> 속성이 무시돼 모바일에서는 PDF가 같은 창에서 열려 버린다.
  // Supabase 공개 주소에 ?download=파일명 을 붙이면 서버가 attachment(저장) 응답을 주므로 모든 브라우저에서 저장된다.
  const saveHref = $derived.by(() => {
    if (!simple || !downloadUrl || !downloadFilename) return downloadUrl
    try {
      const u = new URL(downloadUrl, window.location.href)
      u.searchParams.set('download', downloadFilename)
      return u.toString()
    } catch {
      return downloadUrl
    }
  })

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onclose()
    }
  }

  onMount(() => {
    closeBtn?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden' // 뒤 화면이 같이 스크롤되지 않게
    return () => { document.body.style.overflow = prev }
  })
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="pm-backdrop" role="presentation" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div class="pm-modal" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <div class="pm-head" class:pm-head--tint={simple}>
      <span class="pm-title" title={title}>{title}</span>
      <button type="button" class="pm-close" bind:this={closeBtn} onclick={onclose} aria-label="닫기">✕</button>
    </div>
    <div class="pm-body">
      <PdfViewer {src} {title} downloadUrl={saveHref} {downloadFilename} docLabel="문서" light {simple} />
    </div>
  </div>
</div>

<style>
  .pm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(16, 11, 50, 0.6);
    overscroll-behavior: contain;
  }
  .pm-modal {
    display: flex;
    flex-direction: column;
    width: min(960px, 100%);
    height: min(88vh, 900px);
    min-height: 0;
    overflow: hidden;
    background: var(--cs-lilac);
    border-radius: var(--radius-lg);
  }
  .pm-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 8px 0 20px;
    height: 52px;
  }
  /* 단순 뷰어(고객 화면): 머리줄은 PDF 위에 겹쳐 뜬 반투명 유리(옅은 퍼플 + 약한 블러)라 스크롤하면 아래로 PDF가 흐리게 비친다.
     머리줄 높이(52px)는 PdfViewer 단순 모드의 첫 쪽 위 여백(64px = 52 + 12)과 짝 — 함께 바꾼다 */
  .pm-modal:has(.pm-head--tint) { position: relative; isolation: isolate; background: var(--cs-surface-gray); border-radius: var(--radius-xl); } /* isolation: 블러 요소가 둥근 모서리 클리핑을 벗어나는 것을 막는다 */
  .pm-backdrop:has(.pm-head--tint) { backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); } /* 강한 블러 — 모달 백드롭 표준 */
  .pm-head--tint {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    padding-left: 24px;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0; /* 블러(backdrop-filter) 요소는 부모의 둥근 모서리 바깥으로 비어져 나와 모서리가 각져 보이므로 같은 반경을 직접 준다(모바일 20px은 아래 미디어 쿼리) */
    background: color-mix(in srgb, var(--cs-purple-op10) 78%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .pm-head--tint .pm-title { font: var(--text-pc-title-16); }
  .pm-head--tint .pm-close:hover { background: color-mix(in srgb, var(--cs-white) 60%, transparent); }
  .pm-title {
    flex: 1;
    min-width: 0;
    color: var(--cs-text);
    font: var(--text-pc-body-14);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pm-close {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--cs-text);
    font-size: 18px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .pm-close:hover { background: var(--cs-purple-op10); }
  .pm-body {
    flex: 1;
    min-height: 0;
  }
  /* 모바일: 화면을 거의 꽉 채운다 */
  @media (max-width: 640px) {
    .pm-backdrop { padding: 8px; }
    .pm-modal { height: 94vh; border-radius: var(--radius-md); }
    .pm-modal:has(.pm-head--tint) { border-radius: 20px; }
    .pm-head--tint { padding-left: 20px; border-radius: 20px 20px 0 0; }
    .pm-head--tint .pm-title { font: var(--text-m-body-16B); }
  }
</style>
