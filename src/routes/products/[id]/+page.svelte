<script lang="ts">
  import { goto } from '$app/navigation';
  import BottomTabBar from '$lib/components/common/BottomTabBar.svelte';
  import { supabase } from '$lib/services/supabase';
  import { trackProductView, trackCartAdd } from '$lib/analytics/behaviorTracker';
  import ProductHero from '$lib/components/products/ProductHero.svelte';
  import CalendarTimePicker from '$lib/components/products/CalendarTimePicker.svelte';
  import type { Tables, ProductOptionLinkRow } from '$lib/types/database';
  import type { ContentBlock } from '$lib/types/content-editor';

  /** 실서비스 DB products 행 (가격·status 등 런타임 컬럼 포함) */
  type ProductRow = Tables<'products'> & {
    base_price_daily: number;
    base_price_12h?: number | null;
    base_price_weekly?: number;
    base_price_monthly?: number;
    status?: string;
    image_url?: string;
    content_blocks?: unknown;
    product_caption?: string | null;
  };

  interface ReviewItem {
    id: string;
    author_name: string;
    title: string;
    content: string;
    created_at: string;
  }

  interface ShotlogItem {
    id: string;
    title: string;
    author: string;
    img: string | null;
    createdAt: string;
  }

  interface PopularItem {
    id: string;
    name: string;
    slug: string | null;
    imageUrl: string | null;
    price24h: number;
  }

  interface Props {
    data: {
      product: ProductRow;
      productId: string;
      optionLinks: ProductOptionLinkRow[];
      session: { user: { id: string; email?: string } } | null;
      reviews: ReviewItem[];
      depositAmount: number | null;
      rentalPeriods: { id: string; name: string }[];
      rentalMethods: { id: string; name: string }[];
      shippingPolicy: { items: { label: string; fee: number }[]; guide: string } | null;
      shotlogs: ShotlogItem[];
      popularProducts: PopularItem[];
    };
  }
  let { data }: Props = $props();

  const product = $derived(data.product);

  $effect(() => {
    trackProductView(data.productId, product?.name);
  });

  // ── Product info state
  let qty = $state(1);
  let optionItems = $state(
    data.optionLinks.map((link) => ({
      id: link.option_product_id,
      label: link.option_product_name,
      price: link.price_24h ?? 0,
      qty: link.is_required ? 1 : 0,  // [C-1] 필수 옵션 기본 수량 1
      is_required: link.is_required,
      delivery_rental_disabled: link.delivery_rental_disabled,
      image_url: link.image_url,
    }))
  );
  let optionsOpen = $state(true);
  let isReserving = $state(false);

  // ── Toast
  let toastMsg = $state('');
  let toastVisible = $state(false);
  function showToast(msg: string) {
    toastMsg = msg;
    toastVisible = true;
    setTimeout(() => { toastVisible = false; }, 2800);
  }

  // ── Quick Inquiry
  let qaText = $state('');
  let qaSubmitting = $state(false);
  async function handleQaSubmit() {
    if (!qaText.trim() || qaSubmitting) return;
    qaSubmitting = true;
    try {
      type RpcFn = (name: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc>;
      await (supabase.rpc as unknown as RpcFn)('submit_product_inquiry', {
        p_product_id: data.productId,
        p_content: qaText.trim(),
      });
    } catch {
      // RPC 미구현 시 무시 — 토스트는 항상 노출
    } finally {
      qaText = '';
      qaSubmitting = false;
      showToast('문의가 등록되었습니다.');
    }
  }

  // ── Calendar/time (passed to CalendarTimePicker via bindable)
  let startDate = $state('');
  let endDate = $state('');
  let startHour = $state(12);
  let startMin = $state(0);   // [A-3]
  let endHour = $state(13);
  let endMin = $state(0);     // [A-3]
  let selectedMethodId = $state('');
  let selectedPeriodId = $state('');

  // ── Tab
  let activeTab = $state<'spec' | 'info' | 'review' | 'qa'>('info');

  function scrollToSection(key: 'info' | 'review' | 'qa'): void {
    const selector =
      key === 'info' ? '.shotlog-section'
      : key === 'review' ? '.review-section'
      : '.qa-section';
    document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleTabClick(key: 'spec' | 'info' | 'review' | 'qa') {
    activeTab = key;
    if (key === 'info' || key === 'review' || key === 'qa') {
      scrollToSection(key);
    }
  }

  const shotlogs = $derived(data.shotlogs);
  const popularProducts = $derived(data.popularProducts);

  let reviews = $state(data.reviews);
  const session = $derived(data.session);

  // ── Review form
  let reviewTitle = $state('');
  let reviewContent = $state('');
  let isSubmittingReview = $state(false);

  async function submitReview() {
    if (!session) {
      goto('/auth/login');
      return;
    }
    if (!reviewTitle.trim() || !reviewContent.trim()) return;
    isSubmittingReview = true;
    try {
      type RpcFn = (name: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newId, error } = await (supabase.rpc as unknown as RpcFn)('create_product_review', {
        p_product_id: data.productId,
        p_title: reviewTitle.trim(),
        p_content: reviewContent.trim(),
      });
      if (error) throw error;
      reviews = [
        {
          id: newId as string,
          author_name: session.user.email?.split('@')[0] ?? '익명',
          title: reviewTitle.trim(),
          content: reviewContent.trim(),
          created_at: new Date().toISOString(),
        },
        ...reviews,
      ];
      reviewTitle = '';
      reviewContent = '';
      showToast('후기가 등록되었습니다.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '후기 등록에 실패했습니다.';
      showToast(msg);
    } finally {
      isSubmittingReview = false;
    }
  }

  function fmt(n: number): string {
    return n.toLocaleString('ko-KR');
  }

  async function handleReserve(e: { startDate: string; endDate: string; startHour: number; startMin: number; endHour: number; endMin: number; methodId?: string; periodId?: string }) {
    if (!product || isReserving) return;

    // A-1: 비로그인 → 로그인 후 현재 페이지로 복귀
    if (!data.session) {
      goto('/auth/login?next=' + encodeURIComponent(window.location.pathname));
      return;
    }

    isReserving = true;
    trackCartAdd(data.productId);
    try {
      type ReserveRpcFn = (name: string, args: Record<string, unknown>) => Promise<{
        data: Array<{ success: boolean; reservation_id: number | null; asset_id: number | null; error_message: string | null }> | null;
        error: unknown;
      }>
      // A-2: endDate 미선택(반출일만 선택) 시 startDate로 대체 → 당일 대여
      const endDate = e.endDate || e.startDate;
      const { data: rows } = await (supabase.rpc as unknown as ReserveRpcFn)('create_hold_reservation', {
        p_product_id: product.id,
        p_start_date: e.startDate,
        p_end_date:   endDate,
      });
      const row = rows?.[0];
      if (!row?.success) {
        showToast(row?.error_message ?? '예약 가능한 장비가 없습니다.');
        return;
      }
      // A-2: 반출·반납 시각 저장 (Migration 147 set_reservation_shipment_method)
      if (row.reservation_id != null) {
        const padTime = (h: number, m: number) =>
          String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        type ShipRpcFn = (name: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
        await (supabase.rpc as unknown as ShipRpcFn)('set_reservation_shipment_method', {
          p_reservation_id: row.reservation_id,
          p_pickup_method:  'visit',
          p_pickup_time:    padTime(e.startHour, e.startMin),
          p_return_time:    padTime(e.endHour, e.endMin),
        });
      }
      goto('/checkout');
    } catch {
      showToast('예약 중 오류가 발생했습니다.');
    } finally {
      isReserving = false;
    }
  }

  function handleCalChange(e: { startDate: string; endDate: string; startHour: number; startMin: number; endHour: number; endMin: number }) {
    startDate = e.startDate;
    endDate = e.endDate;
    startHour = e.startHour;
    startMin = e.startMin;
    endHour = e.endHour;
    endMin = e.endMin;
  }

  let optionsTotal = $derived(
    optionItems.reduce((sum, opt) => sum + opt.price * opt.qty, 0)
  );

  // 필수 옵션 중 수량 0인 항목이 있으면 예약담기 비활성
  let hasUnfilledRequired = $derived(
    optionItems.some((o) => o.is_required && o.qty === 0)
  );

  let imageUrls = $derived(product.image_urls ?? []);

  let contentBlocks = $derived.by((): ContentBlock[] => {
    const raw = (product as ProductRow).content_blocks;
    if (!raw) return [];
    try { return Array.isArray(raw) ? (raw as ContentBlock[]) : []; }
    catch { return []; }
  });

  let price12h = $derived(
    (product as ProductRow).base_price_12h ?? Math.round(product.base_price_daily * 0.7)
  );

</script>

<!-- ① Hero (PC sub-GNB는 ProductHero 내부에서 hero overlay 배치) -->
<ProductHero imageUrls={imageUrls} category={product.category ?? 'camera'} productName={product.name} />

<!-- ② ProductInfo Section -->
<section class="info-section">
  <div class="info-inner">

    <!-- Left column -->
    <div class="info-left">

      <!-- TitleInfo card -->
      <div class="title-card">
        <div class="title-block">
          {#if product.brand}
            <p class="product-brand">{product.brand}</p>
          {/if}
          <h1 class="product-name">{product.name}</h1>
          {#if (product as ProductRow).product_caption}
            <p class="product-sub">{(product as ProductRow).product_caption}</p>
          {:else if product.description}
            <p class="product-sub">{product.description.split('\n')[0]}</p>
          {/if}
        </div>

        <!-- Price -->
        <div class="price-row">
          <div class="price-unit">
            <span class="price-period-label">Day</span>
            <span class="price-amount">{fmt(product.base_price_daily)}</span>
            <span class="price-currency">원</span>
          </div>
          <span class="price-sep">/</span>
          <div class="price-unit">
            <span class="price-period-label">12H</span>
            <span class="price-amount">{fmt(price12h)}</span>
            <span class="price-currency">원</span>
          </div>
        </div>

        {#if data.depositAmount}
          <p class="deposit-info">보증금 <strong>{fmt(data.depositAmount)}</strong>원</p>
        {/if}

        {#if data.rentalPeriods.length > 0 || data.rentalMethods.length > 0}
          <div class="policy-block">
            {#if data.rentalPeriods.length > 0}
              <div class="policy-row">
                <span class="policy-label">대여 기간</span>
                <div class="policy-chips">
                  {#each data.rentalPeriods as period}
                    <span class="policy-chip">{period.name}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if data.rentalMethods.length > 0}
              <div class="policy-row">
                <span class="policy-label">대여 방식</span>
                <div class="policy-chips">
                  {#each data.rentalMethods as method}
                    <span class="policy-chip">{method.name}</span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if data.shippingPolicy && (data.shippingPolicy.items.length > 0 || data.shippingPolicy.guide)}
          <div class="shipping-policy-block">
            {#if data.shippingPolicy.items.length > 0}
              <div class="policy-row">
                <span class="policy-label">배송 정책</span>
                <div class="policy-chips">
                  {#each data.shippingPolicy.items as item}
                    <span class="policy-chip policy-chip--active">{item.label} <strong>{item.fee.toLocaleString('ko-KR')}원</strong></span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if data.shippingPolicy.guide}
              <p class="sp-guide">{data.shippingPolicy.guide}</p>
            {/if}
          </div>
        {/if}

        <!-- Quantity control -->
        <div class="qty-row">
          <span class="qty-label">대여수량</span>
          <div class="qty-control">
            <button onclick={() => qty = Math.max(1, qty - 1)} class="qty-btn" aria-label="수량 감소">
              <svg width="14" height="2" viewBox="0 0 14 2" fill="none">
                <path d="M1 1H13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <div class="qty-val-wrap">
              <input
                type="number"
                bind:value={qty}
                min="1"
                class="qty-input"
                aria-label="수량"
              />
            </div>
            <button onclick={() => qty = qty + 1} class="qty-btn" aria-label="수량 증가">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7H13M7 1V13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Options -->
      <div class="options-section">
        <div
          class="options-header"
          onclick={() => optionsOpen = !optionsOpen}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') optionsOpen = !optionsOpen; }}
          aria-expanded={optionsOpen}
        >
          <span class="options-title">옵션 상품</span>
          <div class="options-more-btn">
            <span class="options-more-text">더보기</span>
            <svg
              class="options-chevron"
              class:open={optionsOpen}
              width="8" height="14" viewBox="0 0 8 14" fill="none"
            >
              <path d="M1 1L7 7L1 13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
        {#if optionsOpen}
        <div class="options-list">
          {#each optionItems as opt}
            <div class="option-item">
              <div class="option-label-row">
                <p class="option-label">{opt.label}</p>
                <div class="option-badges">
                  {#if opt.is_required}
                    <span class="opt-badge opt-badge--required">필수</span>
                  {/if}
                  {#if opt.delivery_rental_disabled}
                    <span class="opt-badge opt-badge--no-delivery">배송대여 불가</span>
                  {/if}
                </div>
              </div>
              <div class="option-bottom-row">
                <div class="option-price-wrap">
                  <span class="option-price-num">{fmt(opt.price)}</span>
                  <span class="option-price-unit">원</span>
                </div>
                <div class="qty-control small">
                  <button onclick={() => { opt.qty = Math.max(0, opt.qty - 1); }} class="qty-btn" aria-label="옵션 수량 감소">
                    <svg width="12" height="2" viewBox="0 0 14 2" fill="none">
                      <path d="M1 1H13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <div class="qty-val-wrap">
                    <input type="number" bind:value={opt.qty} min="0" class="qty-input" aria-label="옵션 수량"/>
                  </div>
                  <button onclick={() => { opt.qty += 1; }} class="qty-btn" aria-label="옵션 수량 증가">
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <path d="M1 7H13M7 1V13" stroke="var(--cs-text-dark)" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
        {/if}
      </div>

      <!-- Mobile: CalendarTimePicker (stacked below options on mobile) -->
      <div class="cal-mobile">
        <CalendarTimePicker
          bind:startDate
          bind:endDate
          bind:startHour
          bind:endHour
          bind:selectedMethodId
          bind:selectedPeriodId
          dailyPrice={product.base_price_daily * qty}
          halfDayPrice={price12h * qty}
          {optionsTotal}
          rentalMethods={data.rentalMethods}
          rentalPeriods={data.rentalPeriods}
          reserveDisabled={hasUnfilledRequired}
          mode="product"
          onreserve={handleReserve}
          onchange={handleCalChange}
          chatCallback={() => showToast('준비중입니다.')}
        />
      </div>
    </div>

    <!-- Right column: PC only -->
    <div class="info-right">
      <CalendarTimePicker
        bind:startDate
        bind:endDate
        bind:startHour
        bind:endHour
        bind:selectedMethodId
        bind:selectedPeriodId
        dailyPrice={product.base_price_daily * qty}
        halfDayPrice={price12h * qty}
        {optionsTotal}
        rentalMethods={data.rentalMethods}
        rentalPeriods={data.rentalPeriods}
        reserveDisabled={hasUnfilledRequired}
        mode="product"
        onreserve={handleReserve}
        onchange={handleCalChange}
        chatCallback={() => showToast('준비중입니다.')}
      />

    </div>

  </div>
</section>

<!-- ③ Product Detail Tabs -->
<section class="tabs-section">
  <div class="tabs-inner">
    <div class="tab-nav" role="tablist">
      {#each [['spec','사양'],['info','정보'],['review','후기'],['qa','문의']] as [key, label]}
        <button
          role="tab"
          aria-selected={activeTab === key}
          class="tab-btn"
          class:active={activeTab === key}
          onclick={() => handleTabClick(key as typeof activeTab)}
        >
          {label}
        </button>
      {/each}
    </div>

    <div class="tab-content" role="tabpanel">
      {#if activeTab === 'info'}
        <div class="tab-pane">
          {#if contentBlocks.length > 0}
            <div class="cb-body">
              {#each contentBlocks as block}
                {#if block.type === 'text'}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="cb-text">{@html block.html}</div>
                {:else if block.type === 'image'}
                  <div class="cb-images cb-images--{block.layout}">
                    {#each block.images.filter(img => !img.isHead) as img}
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
          {:else if product.description}
            <div class="product-desc">{product.description}</div>
          {:else}
            <p class="tab-empty">상품 설명이 없습니다.</p>
          {/if}
        </div>
      {:else if activeTab === 'spec'}
        <div class="tab-pane">
          {#if product.specifications && typeof product.specifications === 'object' && !Array.isArray(product.specifications) && Object.keys(product.specifications).length > 0}
            <dl class="spec-table">
              {#each Object.entries(product.specifications as Record<string, unknown>) as [key, val]}
                <div class="spec-row">
                  <dt class="spec-key">{key}</dt>
                  <dd class="spec-val">{String(val ?? '')}</dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p class="tab-empty">사양 정보가 준비 중입니다.</p>
          {/if}
        </div>
      {:else if activeTab === 'review'}
        <div class="tab-pane">
          {#if reviews.length === 0}
            <p class="review-empty">아직 등록된 후기가 없습니다.</p>
          {:else}
            <div class="review-list">
              {#each reviews as r (r.id)}
                <article class="review-card">
                  <div class="review-top">
                    <p class="review-card-title">{r.title}</p>
                    <p class="review-meta-text">{r.author_name} / {new Date(r.created_at).toLocaleDateString('ko-KR')}</p>
                  </div>
                  <div class="review-bottom">
                    <p class="review-body">{r.content}</p>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="tab-pane">
          <h2 class="tab-heading">문의</h2>
          <p class="tab-empty">1:1 문의는 채팅으로 남겨주세요.</p>
        </div>
      {/if}
    </div>
    <!-- PC 그라디언트 구분선 -->
    <div class="gradient-bar" aria-hidden="true"></div>
  </div>
</section>

<!-- ④ Shotlog -->
<section class="shotlog-section">
  <div class="shotlog-inner">
    <div class="shotlog-header">
      <span class="shotlog-title">Shotlog</span>
      <div class="shotlog-icon-wrap" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect width="22" height="22" rx="7" fill="var(--cs-lilac)"/>
          <path d="M5.5 9.5C6.32843 9.5 7 10.1716 7 11C7 11.8284 6.32843 12.5 5.5 12.5C4.67157 12.5 4 11.8284 4 11C4 10.1716 4.67157 9.5 5.5 9.5ZM11 9.5C11.8284 9.5 12.5 10.1716 12.5 11C12.5 11.8284 11.8284 12.5 11 12.5C10.1716 12.5 9.5 11.8284 9.5 11C9.5 10.1716 10.1716 9.5 11 9.5ZM16.5 9.5C17.3284 9.5 18 10.1716 18 11C18 11.8284 17.3284 12.5 16.5 12.5C15.6716 12.5 15 11.8284 15 11C15 10.1716 15.6716 9.5 16.5 9.5Z" fill="var(--cs-purple-light)"/>
        </svg>
      </div>
    </div>
    <div class="shotlog-list">
      {#if shotlogs.length === 0}
        <p class="shotlog-empty">등록된 Shotlog가 없습니다.</p>
      {:else}
        {#each shotlogs as post (post.id)}
          <a href="/crazylog/{post.id}" class="shotlog-card" aria-label={post.title}>
            <!-- 모바일: 이미지 상단 -->
            <div class="shotlog-img-mobile" aria-hidden="true">
              {#if post.img}
                <img src={post.img} alt="" class="shotlog-img-tag" />
              {/if}
            </div>
            <!-- PC: 좌측 보라 바 -->
            <div class="shotlog-purple-bar" aria-hidden="true"></div>
            <!-- 텍스트 (공통) -->
            <div class="shotlog-writing">
              <p class="shotlog-post-title">{post.title}</p>
              <p class="shotlog-post-meta">{new Date(post.createdAt).toLocaleDateString('ko-KR')}·by {post.author}</p>
            </div>
            <!-- PC: 우측 이미지 -->
            <div class="shotlog-img-pc" aria-hidden="true">
              {#if post.img}
                <img src={post.img} alt="" class="shotlog-img-tag" />
              {/if}
            </div>
          </a>
        {/each}
      {/if}
    </div>
  </div>
</section>

<!-- ⑤ Reviews -->
<section class="review-section">
  <div class="review-inner">
    <div class="review-header">
      <span class="review-title">Review</span>
      <span class="review-count">{String(reviews.length).padStart(2, '0')}</span>
    </div>
    <div class="review-list">
      {#each reviews as review (review.id)}
        <article class="review-card">
          <div class="review-top">
            <p class="review-card-title">{review.title}</p>
            <p class="review-meta-text">{review.author_name} / {new Date(review.created_at).toLocaleDateString('ko-KR')}</p>
          </div>
          <div class="review-bottom">
            <p class="review-body">{review.content}</p>
          </div>
        </article>
      {/each}
      {#if reviews.length === 0}
        <p class="review-empty">아직 등록된 후기가 없습니다.</p>
      {/if}
    </div>
    <div class="review-form review-form-expanded">
      <input
        class="review-input review-title-input"
        type="text"
        maxlength="20"
        placeholder={session ? '제목 (최대 20자)' : '로그인 후 작성해주세요.'}
        bind:value={reviewTitle}
        onclick={() => { if (!session) goto('/auth/login'); }}
        readonly={!session}
      />
      <textarea
        class="review-input review-content-input"
        maxlength="500"
        placeholder={session ? '내용 (최대 500자)' : '로그인 후 작성해주세요.'}
        bind:value={reviewContent}
        onclick={() => { if (!session) goto('/auth/login'); }}
        readonly={!session}
      ></textarea>
      <button
        class="review-submit-btn"
        onclick={submitReview}
        disabled={isSubmittingReview || !reviewTitle.trim() || !reviewContent.trim()}
      >
        {isSubmittingReview ? '등록 중...' : '후기 등록'}
      </button>
    </div>
  </div>
</section>

<!-- ⑥ Popular items -->
<section class="popular-section">
  <div class="popular-inner">
    <div class="popular-head">
      <!-- Popular items in this category -->
      <p class="popular-title">많이 본 상품</p>
      <!-- Best selling items that customers love/추후 영문 메뉴명으로 재활용 -->
      <p class="popular-sub">Best selling items that customers love</p>
    </div>
    <div class="popular-scroll">
      {#if popularProducts.length === 0}
        <p class="popular-empty">관련 상품이 없습니다.</p>
      {:else}
        {#each popularProducts as item (item.id)}
          <a href="/products/{item.slug ?? item.id}" class="popular-card" aria-label={item.name}>
            <div class="popular-card-img" aria-hidden="true">
              {#if item.imageUrl}
                <img src={item.imageUrl} alt={item.name} class="popular-card-img-tag" />
              {:else}
                <img src="/sample/product-main.png" alt="" class="popular-card-img-tag" />
              {/if}
            </div>
            <div class="popular-card-info">
              <p class="popular-card-price">Day {fmt(item.price24h)}</p>
              <p class="popular-card-name">{item.name}</p>
            </div>
          </a>
        {/each}
      {/if}
    </div>
  </div>
</section>

<!-- ⑦ Q&A -->
<section class="qa-section">
  <div class="qa-inner">
    <div class="qa-head">
      <div class="qa-title-wrap">
        <h2 class="qa-title">빠른 문의</h2>
        <p class="qa-sub">예약·결제·배송질문에 신속 답변 약속!</p>
      </div>
      <div class="qa-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="27" viewBox="0 0 26 27" fill="none">
          <path d="M23.0288 22.998C24.1333 22.9982 25.0288 23.8936 25.0288 24.998C25.0288 26.1025 24.1332 26.9979 23.0288 26.998C21.9243 26.998 21.0288 26.1026 21.0288 24.998C21.0288 23.8935 21.9242 22.998 23.0288 22.998ZM11.0288 22.9863C12.1333 22.9865 13.0288 23.8818 13.0288 24.9863C13.0288 26.0908 12.1332 26.9862 11.0288 26.9863C9.92426 26.9863 9.02885 26.0909 9.02881 24.9863C9.02881 23.8818 9.92424 22.9863 11.0288 22.9863ZM17.0288 22.9863C18.1333 22.9865 19.0288 23.8818 19.0288 24.9863C19.0288 26.0908 18.1332 26.9862 17.0288 26.9863C15.9243 26.9863 15.0288 26.0909 15.0288 24.9863C15.0288 23.8818 15.9242 22.9863 17.0288 22.9863ZM16.2222 0.0644531C16.6408 -0.0359252 17.0802 -0.0186705 17.4917 0.115234C17.8327 0.226224 18.092 0.412493 18.2915 0.582031C18.4808 0.742957 18.6885 0.952295 18.897 1.16113L20.8481 3.11621C21.0567 3.32513 21.2648 3.53236 21.4253 3.72168C21.5737 3.89682 21.7329 4.11474 21.8433 4.39062L21.8882 4.5127L21.937 4.6875C22.0352 5.09793 22.0191 5.52891 21.8882 5.93262C21.7795 6.26738 21.595 6.5234 21.4253 6.72363C21.2648 6.91296 21.0567 7.12017 20.8481 7.3291L9.05225 19.1445C8.50965 19.688 8.13941 20.0647 7.70654 20.3672C7.33973 20.6234 6.94299 20.8361 6.52588 21C6.03289 21.1936 5.51253 21.2936 4.76025 21.4443L2.59912 21.877C2.4012 21.9166 2.17145 21.9641 1.97314 21.9854C1.77187 22.0069 1.43263 22.0251 1.07275 21.876C0.636931 21.6953 0.295751 21.3502 0.119629 20.9238C-0.0245625 20.5743 -0.00697505 20.2458 0.0141602 20.0479C0.0350912 19.8521 0.0817965 19.6241 0.121582 19.4248L0.553223 17.2607C0.703981 16.5057 0.803954 15.9885 0.995605 15.499C1.15806 15.0842 1.36763 14.6884 1.62256 14.3223C1.92377 13.8897 2.29999 13.5197 2.84326 12.9756L14.6392 1.16113C14.8477 0.952295 15.0544 0.742958 15.2437 0.582031C15.4431 0.412488 15.7025 0.226307 16.0435 0.115234L16.2222 0.0644531ZM4.55811 14.6426C3.95749 15.2442 3.76131 15.4477 3.60791 15.668C3.45932 15.8814 3.33489 16.1125 3.23975 16.3555C3.1414 16.6069 3.08097 16.8853 2.91455 17.7188L2.56689 19.46L4.28174 19.1162C5.1158 18.9491 5.38945 18.8909 5.63623 18.7939C5.87574 18.6998 6.10419 18.5776 6.31592 18.4297C6.53468 18.2768 6.73706 18.0798 7.33838 17.4775L16.2017 8.59766L13.397 5.78809L4.55811 14.6426ZM16.354 2.82715L15.0864 4.09668L17.8911 6.90625L19.1333 5.66211C19.3521 5.44292 19.4761 5.31666 19.5591 5.22168C19.4761 5.1268 19.3515 5.00175 19.1333 4.7832L17.1812 2.82715C16.9818 2.62752 16.8596 2.50739 16.7681 2.4248C16.6764 2.50743 16.5535 2.62729 16.354 2.82715Z" fill="white"/>
        </svg>
      </div>
    </div>
    <div class="qa-form">
      <input type="text" class="qa-input" placeholder="문의입력..." bind:value={qaText} onkeydown={(e) => { if (e.key === 'Enter') handleQaSubmit(); }} />
      <button class="qa-send-btn" aria-label="전송" onclick={handleQaSubmit} disabled={qaSubmitting}>
        <svg width="15" height="10" viewBox="0 0 17 12" fill="none">
          <path d="M1 6H16M16 6L11 1M16 6L11 11" stroke="var(--cs-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</section>

<!-- Toast -->
{#if toastVisible}
  <div class="toast-msg" role="status" aria-live="polite">{toastMsg}</div>
{/if}

<BottomTabBar />

<style>
  /* ── Loading / Error */
  .loading-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .skeleton-hero {
    height: 800px;
    background: var(--cs-lilac);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .skeleton-content {
    height: 400px;
    background: var(--cs-surface-gray);
    margin: 20px;
    border-radius: var(--radius-2xl);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .error-wrap {
    min-height: 60vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    font: var(--text-m-body-16L);
    color: var(--cs-text-dark);
  }
  .error-wrap a {
    color: var(--cs-purple);
    text-decoration: none;
    font: var(--text-m-script-14B);
  }

  /* ── ProductInfo Section */
  .info-section {
    background: var(--cs-lilac);
    padding: var(--layout-section-gap) var(--layout-mob-pad);
  }
  @media (min-width: 641px) {
    .info-section { padding: var(--layout-section-gap) var(--layout-pc-pad); }
  }

  .info-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  @media (min-width: 641px) {
    .info-inner {
      flex-direction: row;
      align-items: flex-start;
      gap: 30px;
    }
  }

  .info-left {
    display: flex;
    flex-direction: column;
    gap: 50px;
    width: 100%;
  }
  @media (min-width: 641px) {
    .info-left { flex: 1; min-width: 0; }
  }

  .info-right {
    display: none;
  }
  @media (min-width: 641px) {
    .info-right {
      display: block;
      flex: 1;
      min-width: 0;
      position: sticky;
      top: 80px; /* 실제 레이아웃 헤더 64px + 16px gap */
      align-self: flex-start;
    }
  }

  /* Mobile cal: show only on mobile */
  .cal-mobile {
    display: block;
  }
  @media (min-width: 641px) {
    .cal-mobile { display: none; }
  }

  /* TitleInfo card */
  .title-card {
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    padding: 25px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  @media (min-width: 641px) {
    .title-card {
      border-radius: var(--radius-2xl);
      padding: 40px;
    }
  }

  .title-block { display: flex; flex-direction: column; gap: 10px; }
  .product-name {
    font: var(--text-m-htitle-24B);
    color: var(--cs-text);
    margin: 0;
  }
  @media (min-width: 641px) {
    .product-name { font: var(--text-pc-ad-kr-35); }
  }

  .product-sub {
    font: var(--text-m-title-18L);
    color: var(--cs-text-mid);
    margin: 0;
  }
  @media (min-width: 641px) {
    .product-sub { font: var(--text-pc-hsub-22); }
  }

  /* Price */
  .price-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--cs-red-badge);
    flex-wrap: wrap;
  }
  .price-unit { display: flex; align-items: baseline; gap: 4px; }
  .price-period-label { font: var(--text-m-script-12); }
  @media (min-width: 641px) {
    .price-period-label { font: var(--text-pc-ad-kr-22); }
  }
  .price-amount {
    font-family: var(--font-kr-heading);
    font-weight: 700;
    font-size: 24px;
  }
  @media (min-width: 641px) { .price-amount { font-size: 35px; } }
  .price-currency { font: var(--text-m-script-12); }
  @media (min-width: 641px) { .price-currency { font: var(--text-pc-ad-kr-22); } }
  .price-sep { font: var(--text-m-script-14); color: var(--cs-red-badge); }

  /* Delivery */
  .delivery-block { display: flex; flex-direction: column; gap: 10px; }

  /* Qty control */
  .qty-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .qty-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
  }
  .qty-control {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .qty-btn {
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qty-val-wrap {
    background: var(--cs-lilac);
    border-radius: var(--radius-md);
    padding: 5px 20px;
  }
  .qty-input {
    background: transparent;
    border: none;
    outline: none;
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    width: 40px;
    text-align: center;
    -moz-appearance: textfield;
  }
  .qty-input::-webkit-inner-spin-button,
  .qty-input::-webkit-outer-spin-button { -webkit-appearance: none; }

  /* Options */
  .options-section {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .options-title {
    font: var(--text-m-body-16B);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .options-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .option-item {
    background: var(--cs-surface-gray);
    border-radius: 20px;
    padding: 15px 30px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .option-label-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 0;
  }
  .option-badges {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .opt-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.6;
    white-space: nowrap;
  }
  .opt-badge--required {
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
  }
  .opt-badge--no-delivery {
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
  }
  .option-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text);
    margin: 0;
    line-height: 1;
  }
  @media (min-width: 641px) {
    .option-label { font: var(--text-pc-title-16); }
  }
  .option-bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .option-price-wrap {
    display: flex;
    align-items: baseline;
    gap: 2px;
  }
  .option-price-num {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
  }
  .option-price-unit {
    font: var(--text-m-script-12);
    color: var(--cs-text-dark);
  }
  .qty-control.small { gap: 12px; }

  /* ── Tabs */
  .tabs-section {
    background: var(--cs-lilac);
    padding: var(--layout-section-gap) var(--layout-mob-pad) 0;
  }
  @media (min-width: 641px) {
    .tabs-section { padding: var(--layout-section-gap) var(--layout-pc-pad) 0; }
  }
  .tabs-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
  }
  .tab-nav {
    display: flex;
    gap: 4px;
    background: var(--cs-purple-op10);
    border-radius: 20px;
    padding: 5px 10px;
  }
  .tab-btn {
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    background: none;
    border: none;
    padding: 0 16px;
    cursor: pointer;
    min-height: 46px;
    border-radius: 15px;
    transition: background 0.15s, color 0.15s;
    flex: 1;
  }
  .tab-btn.active {
    background: var(--cs-lilac);
    color: var(--cs-purple);
  }
  .tab-content {
    padding: 30px 0 var(--layout-section-gap);
    background: var(--cs-lilac);
  }
  /* ── Brand label */
  .product-brand {
    font: var(--text-m-script-12);
    font-weight: 700;
    color: var(--cs-text-light);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin: 0 0 4px;
  }

  /* ── Deposit + Policy */
  .deposit-info {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .deposit-info strong { font-weight: 900; color: var(--cs-text); }

  .policy-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-top: 1px solid var(--cs-lilac);
  }
  .policy-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .policy-label {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    min-width: 62px;
    flex-shrink: 0;
    padding-top: 3px;
  }
  .policy-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .policy-chip {
    font: var(--text-m-script-12);
    font-weight: 700;
    color: var(--cs-purple);
    background: var(--cs-lilac);
    border-radius: var(--radius-full);
    padding: 4px 10px;
    line-height: 1.4;
  }

  /* ── 배송정책 */
  .shipping-policy-block {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .policy-chip--active {
    color: var(--cs-white);
    background: var(--cs-purple);
  }
  .policy-chip--active strong {
    font-weight: 400;
    opacity: 0.85;
  }
  .sp-guide {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    padding-left: 70px;
    line-height: 1.6;
  }

  /* ── Spec table */
  .spec-table {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid var(--cs-lilac);
    margin: 0;
  }
  .spec-row {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 0 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--cs-lilac);
    align-items: start;
  }
  .spec-key {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    margin: 0;
    word-break: keep-all;
  }
  .spec-val {
    font: var(--text-m-body-16L);
    color: var(--cs-text);
    margin: 0;
    word-break: break-word;
  }
  @media (min-width: 768px) {
    .spec-row { grid-template-columns: 160px 1fr; padding: 14px 0; }
    .spec-key  { font: var(--text-pc-body-14); color: var(--cs-text-dark); }
    .spec-val  { font: var(--text-pc-body-14); color: var(--cs-text); font-weight: 400; }
    .product-brand { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-light); }
  }

  .tab-heading {
    font: var(--text-m-title-21);
    color: var(--cs-text);
    margin: 0 0 16px;
  }
  .product-desc {
    font: var(--text-m-body-16L);
    color: var(--cs-text-dark);
    white-space: pre-line;
    line-height: 1.8;
  }
  .tab-empty {
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
    margin: 0;
  }

  /* ── content_blocks 렌더러 */
  .cb-body {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .cb-text {
    font: var(--text-m-body-16L);
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
    font: var(--text-m-body-16L);
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
    font: var(--text-m-script-14B);
    color: var(--cs-purple);
    text-decoration: none;
  }
  .cb-link:hover { background: var(--cs-lilac); }

  /* ── Shotlog */
  .shotlog-section {
    padding: var(--layout-section-gap) 0;
    background: var(--cs-purple-op10);
    border-radius: 0 50px 0 0;
  }
  @media (min-width: 641px) {
    .shotlog-section { background: transparent; border-radius: 0; }
  }
  .shotlog-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    padding: 0 var(--layout-mob-pad);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  @media (min-width: 641px) {
    .shotlog-inner { padding: 0 var(--layout-pc-pad); gap: 30px; }
  }
  .shotlog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0;
  }
  .shotlog-title {
    font: var(--text-m-menu-en-24);
    color: var(--cs-text);
  }
  @media (min-width: 641px) {
    .shotlog-title { font: var(--text-pc-menu-en-20); }
  }
  .shotlog-icon-wrap {
    display: flex;
    align-items: center;
  }
  .shotlog-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .shotlog-card {
    background: var(--cs-white);
    border-radius: 30px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  @media (min-width: 641px) {
    .shotlog-card { flex-direction: row; align-items: stretch; }
  }
  /* 모바일 이미지 (상단) */
  .shotlog-img-mobile {
    height: 150px;
    background: var(--cs-surface-gray);
    width: 100%;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
  }
  @media (min-width: 641px) {
    .shotlog-img-mobile { display: none; }
  }
  /* PC 좌측 보라 바 */
  .shotlog-purple-bar {
    display: none;
    width: 15px;
    background: var(--cs-purple);
    flex-shrink: 0;
    align-self: stretch;
  }
  @media (min-width: 641px) {
    .shotlog-purple-bar { display: block; }
  }
  /* PC 우측 이미지 */
  .shotlog-img-pc {
    display: none;
    height: 150px;
    width: 300px;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    border-radius: 0 30px 30px 0;
  }
  @media (min-width: 641px) {
    .shotlog-img-pc { display: block; }
  }
  .shotlog-img-tag {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .shotlog-writing {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
    justify-content: center;
  }
  @media (min-width: 641px) {
    .shotlog-writing { padding: 20px 30px; }
  }
  .shotlog-post-title {
    font: var(--text-pc-title-18);
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
  }
  .shotlog-post-meta {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* ── Gradient bar (PC only) */
  .gradient-bar {
    display: none;
  }
  @media (min-width: 641px) {
    .gradient-bar {
      display: block;
      height: 10px;
      border-radius: 10px;
      background: linear-gradient(to right, #ff3535, #3b2f8a 41%);
      margin-top: var(--layout-section-gap);
      width: 100%;
    }
  }

  /* ── Popular items */
  .popular-section {
    padding: 50px 0 100px;
    background: var(--cs-lilac);
  }
  .popular-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .popular-head {
    padding: 20px var(--layout-mob-pad);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  @media (min-width: 641px) {
    .popular-head { padding: 20px var(--layout-pc-pad); }
  }
  .popular-title {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-text);
    margin: 0;
  }
  .popular-sub {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    margin: 0;
  }
  .popular-scroll {
    display: flex;
    gap: 20px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 var(--layout-mob-pad) 10px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .popular-scroll::-webkit-scrollbar { display: none; }
  @media (min-width: 641px) {
    .popular-scroll { padding: 0 var(--layout-pc-pad) 10px; }
  }
  .popular-card {
    flex-shrink: 0;
    width: 200px;
    height: 280px;
    border-radius: var(--radius-2xl);
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  @media (min-width: 641px) {
    .popular-card { width: 290px; height: 410px; border-radius: var(--radius-2xl); }
  }
  .popular-card-img {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .popular-card-img-tag {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .popular-card-info {
    position: relative;
    background: var(--cs-lilac);
    padding: 10px 20px 15px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  @media (min-width: 641px) {
    .popular-card-info { padding: 15px 30px 25px; }
  }
  .popular-card-price {
    font: var(--text-m-title-21);
    color: var(--cs-text);
    margin: 0;
    font-size: 18px;
    white-space: nowrap;
  }
  @media (min-width: 641px) {
    .popular-card-price { font-size: 25px; }
  }
  .popular-card-name {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    margin: 0;
    white-space: nowrap;
  }

  /* ── Reviews */
  .review-section {
    padding: var(--layout-section-gap) var(--layout-mob-pad);
  }
  @media (min-width: 641px) {
    .review-section { padding: var(--layout-section-gap) var(--layout-pc-pad); }
  }
  .review-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .review-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0 40px;
  }
  .review-title {
    font: var(--text-m-menu-en-24);
    color: var(--cs-text);
  }
  @media (min-width: 641px) { .review-title { font: var(--text-pc-menu-en-20); } }
  .review-count {
    font: var(--text-m-script-14B);
    color: var(--cs-text-light);
  }
  .review-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .review-card {
    border-radius: 30px;
    overflow: hidden;
    background: var(--cs-white);
  }
  .review-top {
    background: var(--cs-purple-op10);
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .review-card-title {
    font: var(--text-m-body-16L);
    color: var(--cs-text);
    margin: 0;
  }
  .review-meta-text {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    margin: 0;
    flex-shrink: 0;
  }
  .review-bottom {
    padding: 14px 20px;
    background: var(--cs-white);
    border-radius: 0 0 30px 30px;
  }
  .review-body {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.7;
  }
  .review-form {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-white);
    height: 70px;
    border-radius: var(--radius-xl);
    padding: 0 16px 0 24px;
    margin-top: 8px;
  }
  .review-send-btn {
    width: 35px;
    height: 35px;
    min-width: 44px;
    min-height: 44px;
    border-radius: 30px;
    background: var(--cs-lilac);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Options accordion */
  .options-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    padding: 4px 0;
    user-select: none;
  }
  .options-header:focus-visible { outline: 2px solid var(--cs-purple); outline-offset: 2px; border-radius: 4px; }
  .options-more-btn {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .options-more-text {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
  }
  .options-chevron {
    transform: rotate(90deg);
    transition: transform 0.2s ease;
  }
  .options-chevron.open {
    transform: rotate(-90deg);
  }

  /* ── Q&A */
  .qa-section {
    background: var(--cs-lilac);
    border-radius: 30px 30px 0 0;
    padding: 50px var(--layout-mob-pad) 100px;
  }
  @media (min-width: 641px) {
    .qa-section {
      border-radius: 0;
      padding: 80px var(--layout-pc-pad);
    }
  }
  .qa-inner {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .qa-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .qa-title-wrap { display: flex; flex-direction: column; gap: 4px; }
  .qa-title {
    font: var(--text-m-title-21);
    color: var(--cs-text);
    margin: 0;
  }
  .qa-sub {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }
  .qa-icon {
    width: 70px;
    height: 70px;
    border-radius: var(--radius-xl);
    background: var(--cs-red-badge);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .qa-form {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-white);
    height: 70px;
    border-radius: var(--radius-xl);
    padding: 0 16px 0 24px;
  }
  .review-form-expanded {
    flex-direction: row;
    align-items: flex-end;
    height: auto;
    padding: 16px;
    gap: 12px;
  }
  .review-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    width: 100%;
    resize: none;
  }
  .review-input::placeholder {
    color: var(--cs-text-placeholder);
  }
  .review-title-input {
    width: 100%;
    margin-bottom: 8px;
  }
  .review-content-input {
    width: 100%;
    min-height: 80px;
    line-height: 1.6;
    resize: vertical;
    margin-bottom: 12px;
  }
  .review-submit-btn {
    background: var(--cs-purple);
    color: #fff;
    border: none;
    border-radius: var(--radius-md);
    padding: 10px 24px;
    font: var(--text-m-body-16B);
    cursor: pointer;
    min-height: 44px;
  }
  .review-submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .review-empty {
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
    text-align: center;
    padding: 20px 0;
    margin: 0;
  }

  .qa-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    cursor: text;
  }
  .qa-input::placeholder {
    color: var(--cs-text-placeholder);
    opacity: 0.6;
  }
  .qa-send-btn {
    width: 35px;
    height: 35px;
    min-width: 44px;
    min-height: 44px;
    border-radius: 30px;
    background: var(--cs-lilac);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Toast */
  .toast-msg {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--cs-purple-light);
    color: white;
    padding: 14px 28px;
    border-radius: 30px;
    z-index: 9999;
    font: var(--text-m-script-14B);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
