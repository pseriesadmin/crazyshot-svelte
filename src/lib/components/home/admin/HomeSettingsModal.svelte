<script lang="ts" module>
  /** 통합 모달의 설정 섹션 — 값은 홈 화면에서 그 기능이 적용된 위치를 찾는 키로도 쓰인다 */
  export type HomeSettingsSection = 'banner' | 'theme' | 'category' | 'catproducts' | 'md' | 'helphero'
</script>

<script lang="ts">
  // 홈 화면 설정 통합 모달 — 배너·취향직격·카테고리 메뉴·카테고리 상품 슬라이드·모바일 초기 추천·헬프센터 히어로를 한 패널에 섹션으로 배치.
  // 패널 껍데기·공통 스타일·스크롤 연동은 공통 SettingsPanel, 이 파일은 홈의 섹션 구성과 props 전달만 맡는다.
  import { type ComponentProps } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import SettingsPanel from '$lib/components/cms/SettingsPanel.svelte'
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

  function saved(title: string): void {
    csToast.success(`${title} 저장되었습니다.`)
  }
</script>

<SettingsPanel
  title="홈 화면 설정"
  sections={SECTIONS}
  {initialSection}
  {onclose}
  onland={(key) => onland(key as HomeSettingsSection)}
>
  {#snippet renderSection(key, title)}
    {#if key === 'banner'}
      <HomeBannerModal {...banner} embedded onclose={() => saved(title)} />
    {:else if key === 'theme'}
      <HomeThemeGroupModal {...theme} embedded onclose={() => saved(title)} />
    {:else if key === 'category'}
      <ProductCategoryModal {...category} embedded onclose={() => saved(title)} />
    {:else if key === 'catproducts'}
      {#key catProducts.categoryId}
        <HomeCategoryProductsModal {...catProducts} embedded onclose={() => saved(title)} />
      {/key}
    {:else if key === 'md'}
      <ProductMdPickModal {...md} embedded onclose={() => saved(title)} />
    {:else}
      <HelpHeroBgModal {...helpHero} embedded onclose={() => saved(title)} />
    {/if}
  {/snippet}
</SettingsPanel>
