<script lang="ts">
  import { env as publicEnv } from '$env/dynamic/public'
  import { csToast } from '$lib/utils/toast'
  import type { PageData } from './$types'
  import type { ContentBlock } from '$lib/types/content-editor'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // 이미지 갤러리: image_urls 우선, 없으면 단일 image_url 폴백
  let galleryUrls = $derived<string[]>(
    (data.plan.image_urls && (data.plan.image_urls as string[]).length > 0)
      ? (data.plan.image_urls as string[])
      : (data.plan.image_url ? [data.plan.image_url] : [])
  )

  // 콘텐츠블록: content_blocks가 있으면 블록 렌더러, 없으면 plain description 폴백
  let contentBlocks = $derived.by((): ContentBlock[] => {
    const raw = data.plan.content_blocks
    if (!raw) return []
    try { return Array.isArray(raw) ? (raw as ContentBlock[]) : [] }
    catch { return [] }
  })

  // TossPayments v2 CDN SDK — declare global 불가로 타입 별칭 캐스팅 사용
  type TossPaymentsInstance = {
    payment: (opts: { customerKey: string }) => {
      requestBillingAuth: (opts: {
        method: 'CARD'
        successUrl: string
        failUrl: string
        customerEmail?: string
      }) => Promise<void>
    }
  }
  type TossWindow = typeof window & { TossPayments?: (clientKey: string) => TossPaymentsInstance }

  let isLoading = $state(false)

  function loadTossScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as unknown as TossWindow).TossPayments) { resolve(); return }
      const existing = document.querySelector('script[data-toss-sdk]')
      if (existing) {
        existing.addEventListener('load', () => resolve())
        return
      }
      const script = document.createElement('script')
      script.src = 'https://js.tosspayments.com/v2/standard'
      script.dataset.tossSdk = 'true'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('TossPayments SDK 로드 실패'))
      document.head.appendChild(script)
    })
  }

  async function handleSubscribe(): Promise<void> {
    isLoading = true
    try {
      await loadTossScript()
      const tossPayments = (window as unknown as TossWindow).TossPayments?.(publicEnv.PUBLIC_TOSS_CLIENT_KEY ?? '')
      if (!tossPayments) throw new Error('TossPayments SDK 초기화 실패')

      const payment = tossPayments.payment({ customerKey: data.customerKey })
      const origin = window.location.origin
      await payment.requestBillingAuth({
        method: 'CARD',
        successUrl: `${origin}/subscribe/success?planId=${data.plan.id}`,
        failUrl: `${origin}/subscribe/fail?planId=${data.plan.id}`,
        customerEmail: data.customerEmail || undefined,
      })
    } catch (err) {
      isLoading = false
      const message = err instanceof Error ? err.message : '카드 등록 중 오류가 발생했습니다.'
      csToast.error(message)
    }
  }
</script>

<svelte:head>
  <title>{data.plan.name} 구독하기 — CrazyShot</title>
</svelte:head>

<div class="subscribe-wrap">
  <div class="subscribe-card">
    <!-- 이미지: 다중 갤러리(image_urls) 우선, 단일 image_url 폴백 -->
    {#if galleryUrls.length > 1}
      <div class="subscribe-gallery">
        {#each galleryUrls as url}
          <img src={url} alt="" class="subscribe-gallery-img" loading="lazy" />
        {/each}
      </div>
    {:else if galleryUrls.length === 1}
      <img src={galleryUrls[0]} alt="" class="subscribe-img" />
    {/if}

    <h1 class="subscribe-name">{data.plan.name}</h1>
    {#if data.plan.tagline}
      <p class="subscribe-tagline">{data.plan.tagline}</p>
    {/if}
    <p class="subscribe-price">{data.plan.monthly_price.toLocaleString()}<span>원 / 월</span></p>

    <!-- 설명: content_blocks 있으면 블록 렌더러, 없으면 plain description 폴백 -->
    {#if contentBlocks.length > 0}
      <div class="cb-body">
        {#each contentBlocks as block}
          {#if block.type === 'text'}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="cb-text">{@html block.html}</div>
          {:else if block.type === 'image'}
            <div class="cb-images cb-images--{block.layout}">
              {#each block.images.filter((img: { isHead?: boolean }) => !img.isHead) as img}
                <img src={img.url} alt={img.alt} loading="lazy" class="cb-img" />
              {/each}
            </div>
          {:else if block.type === 'youtube'}
            <div class="cb-youtube">
              <iframe
                src="https://www.youtube.com/embed/{block.videoId}"
                title="YouTube 영상"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
                loading="lazy"
              ></iframe>
            </div>
          {:else if block.type === 'html'}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="cb-html">{@html block.content}</div>
          {:else if block.type === 'divider'}
            <hr class="cb-divider" />
          {:else if block.type === 'link-entry'}
            <a href={block.url} class="cb-link" target="_blank" rel="noopener noreferrer">{block.text}</a>
          {/if}
        {/each}
      </div>
    {:else if data.plan.description}
      <p class="subscribe-desc">{data.plan.description}</p>
    {/if}

    <button type="button" class="subscribe-cta" disabled={isLoading} onclick={handleSubscribe}>
      {isLoading ? '카드 등록창 여는 중...' : '카드 등록하고 구독 시작'}
    </button>
    <p class="subscribe-notice">
      매달 자동으로 결제되며, 언제든지 마이페이지에서 해지할 수 있습니다.
    </p>
  </div>
</div>

<style>
  .subscribe-wrap {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--cs-lilac); padding: 40px 20px;
  }
  .subscribe-card {
    width: 100%; max-width: 420px; background: var(--cs-white); border-radius: var(--radius-2xl, 50px);
    padding: 40px 32px; display: flex; flex-direction: column; align-items: center; gap: 12px;
    text-align: center;
  }
  .subscribe-img { width: 140px; height: 140px; object-fit: contain; margin-bottom: 8px; }
  .subscribe-name { font-family: var(--font-kr); font-size: 24px; font-weight: 900; color: var(--cs-text); margin: 0; }
  .subscribe-tagline {
    background: var(--cs-red-badge); color: var(--cs-white); font-size: 14px; font-weight: 700;
    border-radius: 20px; padding: 6px 16px; margin: 0;
  }
  .subscribe-price { font-family: var(--font-kr); font-size: 32px; font-weight: 900; color: var(--cs-purple); margin: 8px 0; }
  .subscribe-price span { font-size: 16px; font-weight: 700; color: var(--cs-text-mid); margin-left: 4px; }
  .subscribe-desc { font-size: 14px; color: var(--cs-text-mid); line-height: 1.6; margin: 0 0 8px; }

  .subscribe-cta {
    width: 100%; padding: 16px; border: none; border-radius: var(--radius-xl);
    background: var(--cs-red-badge); color: var(--cs-white); font-size: 16px; font-weight: 700;
    cursor: pointer; transition: opacity 0.15s;
  }
  .subscribe-cta:hover:not(:disabled) { opacity: 0.85; }
  .subscribe-cta:disabled { opacity: 0.6; cursor: not-allowed; }

  .subscribe-notice { font-size: 12px; color: var(--cs-text-light); margin: 0; }

  /* 다중 이미지 갤러리 */
  .subscribe-gallery {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin-bottom: 8px;
  }
  .subscribe-gallery-img {
    width: 100%;
    border-radius: var(--radius-md);
    object-fit: cover;
    max-height: 240px;
  }

  /* ── content_blocks 렌더러 (products/[id] 패턴 이식) */
  .cb-body {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
    text-align: left;
  }
  .cb-text {
    font-size: 14px;
    color: var(--cs-text-dark);
    line-height: 1.8;
  }
  .cb-text :global(p)  { margin: 0 0 12px; }
  .cb-text :global(ul),
  .cb-text :global(ol) { padding-left: 20px; margin: 0 0 12px; }
  .cb-text :global(h1),
  .cb-text :global(h2),
  .cb-text :global(h3) { margin: 0 0 8px; }
  .cb-images {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .cb-images--full .cb-img  { width: 100%; }
  .cb-images--half .cb-img  { width: calc(50% - 4px); }
  .cb-images--third .cb-img { width: calc(33.333% - 6px); }
  .cb-img {
    border-radius: var(--radius-md);
    object-fit: cover;
    display: block;
    max-width: 100%;
  }
  .cb-youtube {
    position: relative;
    width: 100%;
    padding-bottom: 56.25%;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #000;
  }
  .cb-youtube iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
  }
  .cb-html {
    font-size: 14px;
    color: var(--cs-text-dark);
    line-height: 1.8;
  }
  .cb-divider {
    border: none;
    border-top: 1px solid var(--cs-lilac);
    margin: 0;
  }
  .cb-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border: 1px solid var(--cs-purple);
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-purple);
    text-decoration: none;
  }
  .cb-link:hover { background: var(--cs-lilac); }
</style>
