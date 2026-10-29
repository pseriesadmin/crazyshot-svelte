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
  }

  let { src, title, downloadUrl, downloadFilename, onclose }: Props = $props()

  let closeBtn = $state<HTMLButtonElement | null>(null)

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
    <div class="pm-head">
      <span class="pm-title" title={title}>{title}</span>
      <button type="button" class="pm-close" bind:this={closeBtn} onclick={onclose} aria-label="닫기">✕</button>
    </div>
    <div class="pm-body">
      <PdfViewer {src} {title} {downloadUrl} {downloadFilename} docLabel="문서" light />
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
  }
</style>
