<script lang="ts">
  interface Props {
    /** home: FAQ(purple-20) 위 → lilac / products(All): 흰 목록 위 → lilac (정본) */
    surface?: 'home' | 'products'
  }

  let { surface = 'products' }: Props = $props()

  interface BrandLogoImgStyle {
    h: string
    l: string
    t: string
    w: string
  }

  interface BrandLogo {
    src: string
    h: string
    w: string
    cover?: boolean
    imgStyle?: BrandLogoImgStyle
  }

  /** /products +page.svelte 정본 — 브랜드 마퀴 자산·치수 SSOT */
  const BRAND_LOGOS: BrandLogo[] = [
    { src: '/images/products/brand-canon.png', h: '27.68px', w: '93px', imgStyle: { h: '145.67%', l: '-16.29%', t: '-20.32%', w: '132.5%' } },
    { src: '/images/products/brand-samsung.png', h: '23.602px', w: '154px', cover: true },
    { src: '/images/products/brand-nikon.png', h: '25px', w: '143.191px', imgStyle: { h: '140.12%', l: '-3.16%', t: '-18.25%', w: '106.15%' } },
    { src: '/images/products/brand-gopro.png', h: '33px', w: '102.969px', imgStyle: { h: '325.76%', l: '-34.39%', t: '-112.88%', w: '167.04%' } },
  ]

  const marqueeLogos = [...BRAND_LOGOS, ...BRAND_LOGOS, ...BRAND_LOGOS, ...BRAND_LOGOS]
</script>

<div class="brand-marquee-wrap" class:surface-home={surface === 'home'} class:surface-products={surface === 'products'}>
  <div class="marquee-fade-left" aria-hidden="true"></div>
  <div class="marquee-fade-right" aria-hidden="true"></div>
  <div class="marquee-inner">
    {#each marqueeLogos as logo}
      <div class="marquee-logo-box" style="height:{logo.h};width:{logo.w}">
        {#if logo.cover}
          <img src={logo.src} alt="" class="abs-img" style="inset:0;width:100%;height:100%;object-fit:cover" loading="lazy" />
        {:else if logo.imgStyle}
          <img
            src={logo.src}
            alt=""
            class="abs-img"
            style="height:{logo.imgStyle.h};left:{logo.imgStyle.l};top:{logo.imgStyle.t};width:{logo.imgStyle.w}"
            loading="lazy"
          />
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .abs-img {
    position: absolute;
    max-width: none;
    pointer-events: none;
  }

  .brand-marquee-wrap {
    width: 100%;
    max-width: 1240px;
    margin: 0 auto;
    height: 135px;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
  }

  /* All(/products) — 흰 상품목록 아래: white → lilac (front-uiux .bg-gradient-white) */
  .brand-marquee-wrap.surface-products {
    background: linear-gradient(to bottom, var(--cs-white), var(--cs-lilac));
  }

  /* 초기화면 — FAQ(purple-20) 아래: 상단 알파 0 → 하단 purple-20 */
  .brand-marquee-wrap.surface-home {
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--cs-purple-pale) 0%, transparent),
      var(--cs-purple-pale)
    );
  }

  .marquee-fade-left {
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 60px;
    z-index: 10;
    pointer-events: none;
  }

  .marquee-fade-right {
    position: absolute;
    inset-block: 0;
    right: 0;
    width: 60px;
    z-index: 10;
    pointer-events: none;
  }

  .surface-products .marquee-fade-left {
    background: linear-gradient(to right, var(--cs-lilac), transparent);
  }

  .surface-products .marquee-fade-right {
    background: linear-gradient(to left, var(--cs-lilac), transparent);
  }

  .surface-home .marquee-fade-left {
    background: linear-gradient(to right, var(--cs-lilac), transparent);
  }

  .surface-home .marquee-fade-right {
    background: linear-gradient(to left, var(--cs-lilac), transparent);
  }

  .marquee-inner {
    display: flex;
    gap: 80px;
    align-items: center;
    width: max-content;
    flex-shrink: 0;
    animation: marquee-mobile 28s linear infinite;
    padding: 20px 0;
  }

  .brand-marquee-wrap:hover .marquee-inner {
    animation-play-state: paused;
  }

  .marquee-logo-box {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
  }

  @keyframes marquee {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }

  @keyframes marquee-mobile {
    from { transform: scale(0.7) translateX(0); }
    to { transform: scale(0.7) translateX(-50%); }
  }

  @media (min-width: 641px) {
    .brand-marquee-wrap {
      max-width: 100%;
    }

    /* All PC — 좌우 페이드는 상단 white 톤과 맞춤 */
    .surface-products .marquee-fade-left {
      background: linear-gradient(to right, var(--cs-white), transparent);
    }

    .surface-products .marquee-fade-right {
      background: linear-gradient(to left, var(--cs-white), transparent);
    }

    .marquee-inner {
      animation: marquee 28s linear infinite;
    }
  }
</style>
