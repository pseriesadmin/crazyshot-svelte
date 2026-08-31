<script lang="ts">
  import type { PageData } from './$types'
  import type { ContentBlock } from '$lib/types/content-editor'
  import { page } from '$app/stores'
  // 정기결제(빌링, mid=bill_crazyhevr) 전용 클라이언트 키 — 단건결제(mid=crazysfc8s)
  // PUBLIC_TOSS_CLIENT_KEY와는 서로 다른 상점의 별개 키(공용 아님)
  import { env as publicEnv } from '$env/dynamic/public'

  // Toss v2 standard SDK 타입 정의 (requestBillingAuth 전용)
  type TossPaymentsSDK = (clientKey: string) => {
    payment(opts: { customerKey: string }): {
      requestBillingAuth(params: {
        method: string
        successUrl: string
        failUrl: string
        customerName?: string
        customerEmail?: string
      }): Promise<void>
    }
  }

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

  let isLoading = $state(false)
  // Toss 빌링 인증 실패 시 failUrl(?error=billing)로 리다이렉트되는데, 이 쿼리파라미터를
  // 읽어 안내하는 로직이 없어 사용자가 실패 이유를 전혀 알 수 없던 결함 수정(2026-08-20)
  let subscribeError = $state($page.url.searchParams.get('error') === 'billing'
    ? '카드 등록에 실패했습니다. 다시 시도해 주세요.'
    : '')

  // Toss v2 standard SDK CDN 로드 헬퍼 (contract/[token]/+page.svelte와 동일 패턴)
  async function loadTossSDK(): Promise<void> {
    if ((window as Window & { TossPayments?: unknown }).TossPayments) return
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://js.tosspayments.com/v2/standard'
      script.onload  = () => resolve()
      script.onerror = () => reject(new Error('Toss SDK 로드에 실패했습니다. 다시 시도해 주세요.'))
      document.head.appendChild(script)
    })
  }

  // 구독 빌링 인증 — Toss requestBillingAuth → successUrl(/subscribe/success?planId=…)
  // success 서버가 authKey + customerKey를 billingKey로 교환 → create_user_subscription RPC 호출
  async function handleSubscribe(): Promise<void> {
    subscribeError = ''
    isLoading = true
    try {
      await loadTossSDK()
      const toss = (window as Window & { TossPayments?: TossPaymentsSDK }).TossPayments
      if (!toss) throw new Error('Toss SDK를 불러올 수 없습니다. 다시 시도해 주세요.')

      const origin     = window.location.origin
      const successUrl = `${origin}/subscribe/success?planId=${data.plan.id}`
      const failUrl    = `${origin}/subscribe/${data.plan.id}?error=billing`

      const payment = toss(publicEnv.PUBLIC_TOSS_BILLING_CLIENT_KEY ?? '').payment({ customerKey: data.customerKey })
      await payment.requestBillingAuth({
        method:        'CARD',
        successUrl,
        failUrl,
        customerName:  undefined,    // 선택 — 이름 정보가 PageData에 없음
        customerEmail: data.customerEmail || undefined,
      })
      // requestBillingAuth()는 Toss 인증창으로 리다이렉트 — 이 줄 이후 실행 안 됨
    } catch (err) {
      subscribeError = err instanceof Error ? err.message : '카드 등록에 실패했습니다. 다시 시도해 주세요.'
      isLoading = false
    }
  }
</script>

<svelte:head>
  <title>{data.plan.name} 구독하기 — CrazyShot</title>
</svelte:head>

<div class="subscribe-wrap">
  <div class="subscribe-card">
    <!-- 헤더 밴드 — 이미지 + 이름 + 태그라인 + 가격 (PricingCards PC 카드 톤 재활용) -->
    <div class="subscribe-header">
      {#if galleryUrls.length > 0}
        <div class="subscribe-header-img-wrap">
          <img src={galleryUrls[0]} alt="" class="subscribe-header-img" />
        </div>
      {/if}
      <h1 class="subscribe-name">{data.plan.name}</h1>
      {#if data.plan.tagline}
        <p class="subscribe-tagline">{data.plan.tagline}</p>
      {/if}
      <p class="subscribe-price">{data.plan.monthly_price.toLocaleString()}<span>원 / 월</span></p>
    </div>

    <div class="subscribe-body">
      <!-- 나머지 갤러리 이미지(2번째 이후) -->
      {#if galleryUrls.length > 1}
        <div class="subscribe-gallery">
          {#each galleryUrls.slice(1) as url}
            <img src={url} alt="" class="subscribe-gallery-img" loading="lazy" />
          {/each}
        </div>
      {/if}

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

      <!-- 제공 내용 표 테이블 (/members FeaturesTable 라벨 응용 — 이 플랜 값만 단일 열 표시) -->
      {#if data.featureRows.length > 0}
        <div class="feature-table-wrap">
          <p class="feature-table-title">제공 내용</p>
          <table class="feature-table">
            <tbody>
              {#each data.featureRows as row, i (row.label)}
                <tr class:alt={i % 2 !== 0}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <button type="button" class="subscribe-cta" disabled={isLoading} onclick={handleSubscribe}>
        {isLoading ? '카드 등록 중...' : '카드 등록하고 구독 시작'}
      </button>
      {#if subscribeError}
        <p class="subscribe-error" role="alert">{subscribeError}</p>
      {/if}
      <p class="subscribe-notice">
        매달 자동으로 결제되며, 언제든지 마이페이지에서 해지할 수 있습니다.
      </p>
    </div>
  </div>
</div>

<style>
  .subscribe-wrap {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--cs-lilac); padding: 40px 20px;
  }
  .subscribe-card {
    width: 100%; max-width: 900px; background: var(--cs-white); border-radius: var(--radius-2xl, 50px);
    overflow: hidden;
  }

  /* ── 헤더 밴드 — 이미지+이름+태그라인+가격을 진하게 강조 ── */
  .subscribe-header {
    background: var(--cs-purple);
    padding: 40px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
  }
  .subscribe-header-img-wrap {
    width: 220px; height: 220px;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 8px;
  }
  .subscribe-header-img { width: 100%; height: 100%; object-fit: contain; }
  .subscribe-name { font-family: var(--font-kr); font-size: 32px; font-weight: 900; color: var(--cs-white); margin: 0; }
  .subscribe-tagline {
    background: var(--cs-red-badge); color: var(--cs-white); font-size: 15px; font-weight: 700;
    border-radius: 20px; padding: 8px 20px; margin: 0;
  }
  .subscribe-price { font-family: var(--font-kr); font-size: 40px; font-weight: 900; color: var(--cs-white); margin: 8px 0 0; }
  .subscribe-price span { font-size: 18px; font-weight: 700; color: rgba(255,255,255,0.75); margin-left: 4px; }

  /* ── 본문 ── */
  .subscribe-body {
    padding: 40px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .subscribe-desc { width: 100%; font-size: 15px; color: var(--cs-text-mid); line-height: 1.7; margin: 0; }

  .subscribe-cta {
    width: 100%; max-width: 420px; padding: 16px; border: none; border-radius: var(--radius-xl);
    background: var(--cs-red-badge); color: var(--cs-white); font-size: 16px; font-weight: 700;
    cursor: pointer; transition: opacity 0.15s; margin-top: 8px;
  }
  .subscribe-cta:hover:not(:disabled) { opacity: 0.85; }
  .subscribe-cta:disabled { opacity: 0.6; cursor: not-allowed; }

  .subscribe-error { font-size: 13px; color: var(--cs-red-badge); margin: 0; text-align: center; }
  .subscribe-notice { font-size: 12px; color: var(--cs-text-light); margin: 0; }

  /* 다중 이미지 갤러리(헤더 이미지 제외 나머지) */
  .subscribe-gallery {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
  .subscribe-gallery-img {
    width: 100%;
    border-radius: var(--radius-md);
    object-fit: cover;
    max-height: 320px;
  }

  /* ── content_blocks 렌더러 (products/[id] 패턴 이식) ── */
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

  /* ── 제공 내용 표 테이블 (/members FeaturesTable 라벨 응용) ── */
  .feature-table-wrap {
    width: 100%;
  }
  .feature-table-title {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 900;
    color: var(--cs-text);
    margin: 0 0 12px;
  }
  .feature-table {
    width: 100%;
    border-collapse: collapse;
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .feature-table tr {
    background: var(--cs-white);
  }
  .feature-table tr.alt {
    background: var(--cs-surface-gray);
  }
  .feature-table th {
    text-align: left;
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-text-mid);
    padding: 14px 16px;
    width: 55%;
  }
  .feature-table td {
    text-align: right;
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-purple);
    padding: 14px 16px;
  }

  /* PC 반응형 — 카드를 좀 더 넓게, 헤더 이미지도 더 크게 */
  @media (min-width: 768px) {
    .subscribe-wrap { padding: 60px 20px; }
    .subscribe-header { padding: 56px 48px; }
    .subscribe-header-img-wrap { width: 280px; height: 280px; }
    .subscribe-name { font-size: 40px; }
    .subscribe-price { font-size: 52px; }
    .subscribe-body { padding: 48px; }
  }
</style>
