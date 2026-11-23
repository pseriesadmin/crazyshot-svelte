<script lang="ts" module>
  /** 통합 모달의 설정 섹션 — 값은 홈 화면에서 그 기능이 적용된 위치를 찾는 키로도 쓰인다 */
  export type HomeSettingsSection = 'banner' | 'theme' | 'category' | 'catproducts' | 'md' | 'helphero'
</script>

<script lang="ts">
  // 홈 화면 설정 통합 모달 — 배너·취향직격·카테고리 메뉴·카테고리 상품 슬라이드·모바일 초기 추천·헬프센터 히어로를 한 패널에 섹션으로 배치.
  // 각 섹션은 기존 모달 컴포넌트를 embedded 모드로 그대로 재사용하므로 저장 방식은 섹션마다 [저장]이다(다른 섹션 입력은 건드리지 않음).
  // 모달을 스크롤해 섹션 헤더가 위쪽에 닿으면 onland(섹션)를 호출해 뒤의 홈 화면이 그 기능의 실제 위치로 이동하게 한다.
  import { tick, type ComponentProps } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import HomeBannerModal from './HomeBannerModal.svelte'
  import HomeThemeGroupModal from './HomeThemeGroupModal.svelte'
  import HomeCategoryProductsModal from './HomeCategoryProductsModal.svelte'
  import ProductCategoryModal from '$lib/components/products/admin/ProductCategoryModal.svelte'
  import ProductMdPickModal from '$lib/components/products/admin/ProductMdPickModal.svelte'
  import HelpHeroBgModal from '$lib/components/help/admin/HelpHeroBgModal.svelte'

  type Strip<P> = Omit<P, 'onclose' | 'embedded'>

  interface Props {
    banner: Strip<ComponentProps<typeof HomeBannerModal>>
    theme: Strip<ComponentProps<typeof HomeThemeGroupModal>>
    category: Strip<ComponentProps<typeof ProductCategoryModal>>
    catProducts: Strip<ComponentProps<typeof HomeCategoryProductsModal>>
    md: Strip<ComponentProps<typeof ProductMdPickModal>>
    helpHero: Strip<ComponentProps<typeof HelpHeroBgModal>>
    /** 열릴 때 먼저 보여줄 섹션 */
    initialSection: HomeSettingsSection
    onclose: () => void
    /** 섹션 헤더가 위쪽에 닿았을 때 — 홈 화면을 그 기능의 위치로 이동 */
    onland: (section: HomeSettingsSection) => void
  }

  let { banner, theme, category, catProducts, md, helpHero, initialSection, onclose, onland }: Props = $props()

  const SECTIONS: { key: HomeSettingsSection; title: string }[] = [
    { key: 'banner', title: '홈 히어로 배너' },
    { key: 'theme', title: '취향직격 테마그룹' },
    { key: 'category', title: '카테고리 메뉴' },
    { key: 'catproducts', title: '카테고리 상품 슬라이드' },
    { key: 'md', title: '모바일 초기 추천 (미·칠 PICK)' },
    { key: 'helphero', title: '헬프센터 히어로' },
  ]

  let scrollEl: HTMLDivElement | undefined = $state()
  let lastLanded: HomeSettingsSection | null = null
  // 모달이 직접 스크롤시키는 동안(열릴 때 이동 등)에는 스크롤 감지가 뒤 화면을 다시 움직이지 않게 막는다
  let quietUntil = 0

  function scrollToSection(key: HomeSettingsSection): void {
    if (!scrollEl) return
    const el = scrollEl.querySelector<HTMLElement>(`[data-section="${key}"]`)
    if (!el) return
    // 먼 섹션으로의 부드러운 이동이 길어져도 중간 섹션이 뒤 화면을 움직이지 않도록, 이동이 끝나는 이벤트(scrollend)까지 억제(최대 2초)
    quietUntil = Date.now() + 2000
    scrollEl.addEventListener('scrollend', () => { quietUntil = Date.now() + 150 }, { once: true })
    scrollEl.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
    lastLanded = key
    onland(key)
  }

  // 열릴 때: 눌렀던 버튼의 섹션으로 이동
  $effect(() => {
    if (!scrollEl) return
    void tick().then(() => scrollToSection(initialSection))
  })

  // 스크롤 감지: 섹션 헤더가 스크롤 영역 위쪽 25% 안에 들어오면 그 섹션의 홈 위치로 이동
  $effect(() => {
    const root = scrollEl
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < quietUntil) return
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const key = (entry.target as HTMLElement).dataset.head as HomeSettingsSection | undefined
          if (!key || key === lastLanded) continue
          lastLanded = key
          onland(key)
        }
      },
      { root, rootMargin: '0px 0px -75% 0px', threshold: 0 },
    )
    root.querySelectorAll<HTMLElement>('[data-head]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  })

  function saved(title: string): void {
    csToast.success(`${title} 저장되었습니다.`)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="hs-backdrop" onclick={onclose} role="presentation"></div>

<aside class="hs-panel" role="dialog" aria-modal="true" aria-label="홈 화면 설정">
  <div class="hs-header">
    <span class="hs-title">홈 화면 설정</span>
    <button class="hs-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="hs-scroll" bind:this={scrollEl}>
    {#each SECTIONS as s (s.key)}
      <section class="hs-section" data-section={s.key}>
        <div class="hs-head" data-head={s.key}>
          <span class="hs-head-title">{s.title}</span>
        </div>
        <div class="hs-content">
          {#if s.key === 'banner'}
            <HomeBannerModal {...banner} embedded onclose={() => saved(s.title)} />
          {:else if s.key === 'theme'}
            <HomeThemeGroupModal {...theme} embedded onclose={() => saved(s.title)} />
          {:else if s.key === 'category'}
            <ProductCategoryModal {...category} embedded onclose={() => saved(s.title)} />
          {:else if s.key === 'catproducts'}
            {#key catProducts.categoryId}
              <HomeCategoryProductsModal {...catProducts} embedded onclose={() => saved(s.title)} />
            {/key}
          {:else if s.key === 'md'}
            <ProductMdPickModal {...md} embedded onclose={() => saved(s.title)} />
          {:else}
            <HelpHeroBgModal {...helpHero} embedded onclose={() => saved(s.title)} />
          {/if}
        </div>
      </section>
    {/each}
  </div>
</aside>

<style>
  .hs-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16, 11, 50, 0.3);
  }

  .hs-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 460px;
    max-width: 100vw;
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .hs-header {
    background: var(--cs-dark);
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .hs-title {
    color: var(--cs-white);
    font: var(--text-pc-title-16);
  }

  .hs-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    min-height: 32px;
  }
  .hs-close:hover { color: var(--cs-white); }

  /* offsetTop 기준이 되도록 position: relative */
  .hs-scroll {
    position: relative;
    flex: 1;
    overflow-y: auto;
    padding-bottom: 120px;
  }

  /* 설정 사이 분리: 섹션 위 넉넉한 여백 + 면(lilac) 헤더 띠 */
  .hs-section + .hs-section { margin-top: 64px; }

  .hs-head {
    background: var(--cs-lilac);
    padding: 14px 24px;
  }

  .hs-head-title {
    color: var(--cs-text);
    font: var(--text-pc-title-16);
  }

  /* ── 통합 모달 공통 스타일 레이어 ──
     6개 섹션이 각자 만든 입력·콤보·추가 버튼·목록 행 스타일을 cms-uiux.md 표준으로 맞춘다(통합 패널 안에서만 적용 — /products·/help 단독 모달은 무변경).
     섹션 컴포넌트의 scoped 규칙보다 우선하도록 .hs-scroll .hs-content 를 앞에 붙인다. */

  /* ① 입력 필드 — §7-7 .f-input: 면(회색)·보더 없음·반경 8px·14px/700·포커스 링 --cs-focus-ring */
  .hs-scroll .hs-content :global(.f-input),
  .hs-scroll .hs-content :global(.cms-field),
  .hs-scroll .hs-content :global(.tg-title-input),
  .hs-scroll .hs-content :global(.tg-subcopy-input),
  .hs-scroll .hs-content :global(.tg-search-f-input),
  .hs-scroll .hs-content :global(.text-input) {
    box-sizing: border-box;
    width: 100%;
    min-height: 40px;
    height: auto;
    padding: 10px 16px;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    outline: none;
  }
  .hs-scroll .hs-content :global(.f-input:focus),
  .hs-scroll .hs-content :global(.cms-field:focus),
  .hs-scroll .hs-content :global(.tg-title-input:focus),
  .hs-scroll .hs-content :global(.tg-subcopy-input:focus),
  .hs-scroll .hs-content :global(.tg-search-f-input:focus),
  .hs-scroll .hs-content :global(.text-input:focus) {
    outline: 2px solid var(--cs-focus-ring);
    outline-offset: -2px;
    border: none;
  }
  .hs-scroll .hs-content :global(.f-input::placeholder),
  .hs-scroll .hs-content :global(.cms-field::placeholder),
  .hs-scroll .hs-content :global(.tg-title-input::placeholder),
  .hs-scroll .hs-content :global(.tg-subcopy-input::placeholder),
  .hs-scroll .hs-content :global(.tg-search-f-input::placeholder),
  .hs-scroll .hs-content :global(.text-input::placeholder) { color: var(--cs-text-light); }
  /* 회색 목록 행·카드 안의 입력은 같은 회색이면 구분이 안 되므로 흰 면으로(§0-10-H 박스 안 입력 규칙) */
  .hs-scroll .hs-content :global(.banner-row .cms-field),
  .hs-scroll .hs-content :global(.banner-row .f-input),
  .hs-scroll .hs-content :global(.tg-group-card .tg-title-input),
  .hs-scroll .hs-content :global(.tg-group-card .tg-subcopy-input),
  .hs-scroll .hs-content :global(.tg-group-card .tg-search-f-input),
  .hs-scroll .hs-content :global(.tg-group-card .f-input) { background: var(--cs-white); }
  .hs-scroll .hs-content :global(.text-input) { line-height: 1.6; resize: vertical; }

  /* ② 옵션 선택 콤보 버튼 — §7-12-B(mk-chip): 32px·좌우 14px·pill·흰 면+lilac 보더·활성 purple (구형 라디오·9px 16px 콤보 통일) */
  .hs-scroll .hs-content :global(.mode-chips),
  .hs-scroll .hs-content :global(.hcp-chips),
  .hs-scroll .hs-content :global(.combo-wrap) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hs-scroll .hs-content :global(.mode-chip),
  .hs-scroll .hs-content :global(.hcp-chip),
  .hs-scroll .hs-content :global(.combo-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 14px;
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--cms-radius-xl, 30px);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .hs-scroll .hs-content :global(.mode-chip--on),
  .hs-scroll .hs-content :global(.hcp-chip--on),
  .hs-scroll .hs-content :global(.combo-btn-active),
  .hs-scroll .hs-content :global(.combo-btn-active:hover) {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
    color: var(--cs-white);
  }
  .hs-scroll .hs-content :global(.mode-chip:not(.mode-chip--on):hover),
  .hs-scroll .hs-content :global(.hcp-chip:not(.hcp-chip--on):hover),
  .hs-scroll .hs-content :global(.combo-btn:not(.combo-btn-active):hover) {
    background: var(--cs-white);
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }
  .hs-scroll .hs-content :global(.combo-label) { font: inherit; color: inherit; }
  .hs-scroll .hs-content :global(.combo-btn-active .combo-label) { color: var(--cs-white); }

  /* ③ 추가 버튼 — 배너 섹션 .btn-add 기준(36px·점선 purple·반경 15px) */
  .hs-scroll .hs-content :global(.btn-add),
  .hs-scroll .hs-content :global(.tg-add-btn) {
    box-sizing: border-box;
    width: 100%;
    height: 36px;
    padding: 0 16px;
    background: none;
    border: 1.5px dashed var(--cs-purple);
    border-radius: var(--radius-md);
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
  }
  .hs-scroll .hs-content :global(.btn-add:hover),
  .hs-scroll .hs-content :global(.tg-add-btn:hover) {
    background: rgba(59, 47, 138, 0.06);
    border-color: var(--cs-purple);
  }

  /* ④ 추가 목록 행·카드 — 회색 면·반경 8px·안쪽 여백 10px (보더 없음) */
  .hs-scroll .hs-content :global(.banner-row),
  .hs-scroll .hs-content :global(.tg-group-card),
  .hs-scroll .hs-content :global(.hcp-selected-row),
  .hs-scroll .hs-content :global(.img-row) {
    padding: 10px;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
  }
  .hs-scroll .hs-content :global(.tg-thumb-btn) {
    border: none;
    background: var(--cs-lilac);
  }
  .hs-scroll .hs-content :global(.btn-icon-pick) {
    border: none;
    background: var(--cs-lilac);
  }
  .hs-scroll .hs-content :global(.btn-icon-pick:hover) {
    background: var(--cs-purple-op10);
    border: none;
  }
</style>
