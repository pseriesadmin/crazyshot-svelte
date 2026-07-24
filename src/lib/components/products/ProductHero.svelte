<script lang="ts">
  import SubGnb from '$lib/components/common/SubGnb.svelte'

  interface Props {
    imageUrls?: string[];
    category?: string;
    productName?: string;
  }

  let { imageUrls = [], category = 'camera', productName = '' }: Props = $props();

  let activeThumb = $state(0);

  function getCloudinaryUrl(publicId: string, w: number, h: number): string {
    return `https://res.cloudinary.com/crazyshot/image/upload/w_${w},h_${h},c_fill,f_auto,q_auto/${publicId}.jpg`;
  }

  function getBgImage(idx: number): string {
    if (!imageUrls[idx]) return '';
    if (imageUrls[idx].startsWith('/') || imageUrls[idx].startsWith('blob:')) return imageUrls[idx];
    if (imageUrls[idx].startsWith('http')) return imageUrls[idx];
    return getCloudinaryUrl(imageUrls[idx], 1240, 1000);
  }

  function isLocalPath(url: string): boolean {
    return url.startsWith('/') || url.startsWith('blob:');
  }

  const CATEGORY_MAP: Record<string, string> = {
    camera: 'Camera', lens: 'Lens', drone: 'Drone',
    phone: 'Phone', video: 'Video', tripod: 'Tripod',
    audio: 'Audio', lighting: 'Lighting',
  };

  const categoryLabel = $derived(CATEGORY_MAP[category] ?? category);
</script>

<div class="hero-wrap">
  <!-- Background image -->
  <div class="hero-bg" style={(!imageUrls[activeThumb] || !isLocalPath(imageUrls[activeThumb])) ? (imageUrls[activeThumb] ? `background-image: url('${getBgImage(activeThumb)}')` : '') : ''}>
    {#if imageUrls[activeThumb] && isLocalPath(imageUrls[activeThumb])}
      <img
        src={imageUrls[activeThumb]}
        alt=""
        class="hero-bg-img"
      />
    {/if}
  </div>

  <!-- GNB: Mobile floating pill -->
  <SubGnb title={categoryLabel} floating />

  <!-- GNB: PC — hero 내부 overlay 배치, 배경 투명으로 카메라 이미지와 겹침 -->
  <SubGnb title={categoryLabel} pcOnly transparent />

  <!-- Bottom: Mobile dots / PC thumbnails -->
  <div class="hero-bottom">
    <!-- Mobile dot indicator -->
    {#if imageUrls.length > 0}
      <div class="dots-mobile">
        {#each imageUrls as _, i}
          <button
            class="dot"
            class:dot-active={i === activeThumb}
            onclick={() => activeThumb = i}
            aria-label="{i+1}번째 이미지"
          ></button>
        {/each}
      </div>
    {/if}

    <!-- PC thumbnail strip -->
    {#if imageUrls.length > 0}
      <div class="thumbs-pc">
        {#each imageUrls as url, i}
          <button
            class="thumb"
            class:thumb-active={i === activeThumb}
            onclick={() => activeThumb = i}
            aria-label="{i+1}번째 이미지"
          >
            <img
              src={url.startsWith('http') ? url : getCloudinaryUrl(url, 140, 140)}
              alt="{productName} 이미지 {i+1}"
              loading="lazy"
            />
            <div class="thumb-overlay"></div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .hero-wrap {
    position: relative;
    height: 800px;
    width: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  @media (min-width: 641px) {
    .hero-wrap { height: 1000px; }
  }

  .hero-bg {
    position: absolute;
    inset: 0;
    background-color: #e1def3;
    background-size: cover;
    background-position: center 20%;
    z-index: 0;
    overflow: hidden;
  }
  .hero-bg-img {
    position: absolute;
    height: 101.41%;
    width: 208.02%;
    left: -63.03%;
    top: -0.66%;
    max-width: none;
    object-fit: cover;
  }

  /* GNB Mobile */
  .gnb-mobile {
    position: relative;
    z-index: 10;
    padding: 40px 25px 0;
  }
  @media (min-width: 641px) { .gnb-mobile { display: none; } }

  .gnb-pill {
    background: var(--cs-lilac-nav);
    backdrop-filter: blur(8px);
    border-radius: var(--radius-lg);
    min-height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 20px;
  }
  .back-btn {
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gnb-cat-label {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    text-align: center;
  }

  /* GNB PC */
  .gnb-pc {
    display: none;
    position: relative;
    z-index: 10;
    padding: 30px 0;
    justify-content: center;
    gap: 30px;
    align-items: center;
  }
  @media (min-width: 641px) { .gnb-pc { display: flex; } }

  .back-pill {
    background: var(--cs-lilac-nav);
    backdrop-filter: blur(8px);
    border: none;
    border-radius: 25px;
    width: 460px;
    min-height: 70px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 40px;
    cursor: pointer;
  }
  .back-icon-wrap {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .back-label {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
  }
  .package-label {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-text);
  }

  .cat-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: flex-end;
    padding: 0 30px;
  }
  .cat-icon-bg {
    background: var(--cs-purple-op10);
    border-radius: var(--radius-xl);
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Bottom */
  .hero-bottom {
    position: relative;
    z-index: 10;
    margin-top: auto;
  }

  /* Mobile dots */
  .dots-mobile {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  @media (min-width: 641px) { .dots-mobile { display: none; } }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    border: none;
    cursor: pointer;
    padding: 0;
    min-width: 20px;
    min-height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dot::after {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    display: block;
  }
  .dot-active::after { background: rgba(255,255,255,0.9); width: 30px; border-radius: 15px; }

  /* PC thumbnails */
  .thumbs-pc {
    display: none;
    gap: 30px;
    align-items: flex-end;
    justify-content: center;
    padding: 40px 35px 25px;
    width: 100%;
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    box-sizing: border-box;
  }
  @media (min-width: 641px) { .thumbs-pc { display: flex; } }

  .thumb {
    position: relative;
    width: 70px;
    height: 70px;
    border-radius: var(--radius-lg);
    border: none;
    cursor: pointer;
    overflow: hidden;
    padding: 0;
    flex-shrink: 0;
  }
  .thumb img, .thumb-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: rgba(255,255,255,0.08);
  }
  .thumb-fallback { background: var(--cs-purple-op10); }
  .thumb-overlay {
    position: absolute;
    inset: 0;
    background: rgba(29,24,62,0.5);
    border-radius: var(--radius-lg);
    transition: opacity 0.15s;
  }
  .thumb-active .thumb-overlay { opacity: 0; }
</style>
