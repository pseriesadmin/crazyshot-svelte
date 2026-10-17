<script lang="ts">
  /**
   * 편집기 자동 검증 전용 화면(개발 서버 한정) — e2e/ 의 Playwright 테스트가 사용한다.
   * 상품설명 편집기(RichContentEditor)와 계약서 문서 편집기(어댑터 ContractFlowEditor)를 같은 화면에 올린다.
   * 이미지는 SVG data URL이라 네트워크·업로드 없이 동작한다.
   */
  import { page } from '$app/state'
  import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'
  import ContractFlowEditor from '$lib/modules/doc-editor/adapters/crazyshot/ContractFlowEditor.svelte'
  import MediaViewer from '$lib/components/common/MediaViewer.svelte'
  import type { MediaViewerItem } from '$lib/types/media-viewer'
  import type { ContentBlock } from '$lib/types/content-editor'

  const svg = (c: string, label: string) =>
    'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100"><rect width="1600" height="1100" fill="${c}"/><text x="800" y="560" font-size="60" text-anchor="middle" fill="#fff">${label}</text></svg>`)

  const which = $derived(page.url.searchParams.get('editor') ?? 'rich')
  const groupCount = $derived(Number(page.url.searchParams.get('n') ?? '1'))

  const imgs = [svg('#3B2F8A', 'A'), svg('#CF0000', 'B')]
  let blocks = $state<ContentBlock[]>([
    { type: 'text', html: '<p>본문 한 줄</p>' } as ContentBlock,
    { type: 'image', layout: 'individual', images: imgs.slice(0, Math.max(1, Math.min(2, Number(page.url.searchParams.get('n') ?? '1')))).map((url, i) => ({ url, alt: `img${i}` })) } as ContentBlock,
    { type: 'text', html: '<p>끝</p>' } as ContentBlock,
  ])
  let keywords = $state<string[]>([])

  const docContent = {
    type: 'tiptap-doc' as const,
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '계약서 본문' }] },
        { type: 'image', attrs: { src: imgs[0], width: 300, align: 'center' } },
        { type: 'paragraph' },
      ],
    },
  }

  // ── 공통 뷰어 단독 검증(?editor=viewer[&kinds=mixed][&ro=1]) ──
  const sm = (c: string, label: string) =>
    'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="${c}"/><text x="400" y="280" font-size="90" text-anchor="middle" fill="#fff">${label}</text></svg>`)
  const mixed = $derived(page.url.searchParams.get('kinds') === 'mixed')
  const readonlyViewer = $derived(page.url.searchParams.get('ro') === '1')
  let vItems = $state<MediaViewerItem[]>([
    { url: sm('#3B2F8A', '1'), name: '첫째' },
    { url: sm('#CF0000', '2'), name: '둘째' },
    { url: sm('#1E88E5', '3'), name: '셋째' },
  ])
  let vIndex = $state(0)
  let vOpen = $state(true)
  const log = $state({ saves: 0, deletes: 0, closed: 0 })
  if (typeof window !== 'undefined') (window as unknown as { __mv: typeof log }).__mv = log
  $effect(() => {
    if (which !== 'viewer' || !mixed) return
    vItems = [
      { url: sm('#3B2F8A', '1'), name: '이미지' },
      { url: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK', type: 'pdf', name: '문서' },
      { url: '', type: 'youtube', videoId: 'dQw4w9WgXcQ', name: '영상' },
    ]
  })
</script>

<!-- ?scroll=1 : CMS 폼 영역처럼 안쪽 여백(20px)이 있는 스크롤 상자 안에 편집기를 둔다(도구줄 고정 위치 검증) -->
<div
  id="e2e-scroller"
  style={page.url.searchParams.get('scroll') === '1' ? 'height: 600px; overflow: auto; padding: 20px; background: #ECEBF4' : 'max-width: 900px; margin: 0 auto; padding: 16px'}
  data-groups={groupCount}
>
  {#if which === 'viewer'}
    <button type="button" id="open-viewer" onclick={() => { vOpen = true }}>뷰어 열기</button>
    {#if vOpen}
      <MediaViewer
        items={vItems}
        bind:index={vIndex}
        title="검증"
        onclose={() => { log.closed += 1; vOpen = false }}
        onDelete={readonlyViewer ? undefined : (i) => { log.deletes += 1; vItems = vItems.filter((_, k) => k !== i); return true }}
        onSave={readonlyViewer ? undefined : () => { log.saves += 1; return true }}
      />
    {/if}
  {:else if which === 'rich'}
    <RichContentEditor bind:blocks bind:keywords showKeywords={false} variant="cms" />
  {:else}
    <ContractFlowEditor initialContent={docContent as never} />
  {/if}
</div>

<style>
  /* 전역 GNB·플로팅 버튼이 편집기 도구줄을 가리지 않게(검증 화면 한정) */
  :global(.gnb-desktop-wrap),
  :global(.gnb-mobile-wrap),
  :global(.fab-bar) { display: none !important; }
</style>
