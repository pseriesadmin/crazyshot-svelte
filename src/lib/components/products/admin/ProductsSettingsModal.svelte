<script lang="ts" module>
  /** 통합 모달의 설정 섹션 — 값은 상품목록 화면에서 그 기능이 적용된 위치를 찾는 키로도 쓰인다 */
  export type ProductsSettingsSection = 'categories' | 'hero' | 'grid' | 'md'
</script>

<script lang="ts">
  // 상품목록(/products) 설정 통합 모달 — 카테고리 메뉴·헤더 상품 슬라이드·상품 그리드·MD 추천을 한 패널에 섹션으로 배치.
  // 패널 껍데기·공통 스타일·스크롤 연동은 공통 SettingsPanel, 이 파일은 상품목록의 섹션 구성과 props 전달만 맡는다(홈 통합 모달과 같은 구조).
  import { type ComponentProps } from 'svelte'
  import { csToast } from '$lib/utils/toast'
  import SettingsPanel from '$lib/components/cms/SettingsPanel.svelte'
  import ProductCategoryModal from './ProductCategoryModal.svelte'
  import ProductHeroModal from './ProductHeroModal.svelte'
  import ProductGridModal from './ProductGridModal.svelte'
  import ProductMdPickModal from './ProductMdPickModal.svelte'

  type Strip<P> = Omit<P, 'onclose' | 'embedded'>

  interface Props {
    categories: Strip<ComponentProps<typeof ProductCategoryModal>>
    hero: Strip<ComponentProps<typeof ProductHeroModal>>
    grid: Strip<ComponentProps<typeof ProductGridModal>>
    md: Strip<ComponentProps<typeof ProductMdPickModal>>
    /** 열릴 때 먼저 보여줄 섹션 */
    initialSection: ProductsSettingsSection
    onclose: () => void
    /** 섹션 헤더가 위쪽에 닿았을 때 — 상품목록 화면을 그 기능의 위치로 이동 */
    onland: (section: ProductsSettingsSection) => void
  }

  let { categories, hero, grid, md, initialSection, onclose, onland }: Props = $props()

  // 화면 위에서 아래 순서(카테고리 → 헤더 슬라이드 → 상품 그리드 → MD 추천)
  const SECTIONS: { key: ProductsSettingsSection; title: string }[] = [
    { key: 'categories', title: '카테고리 메뉴' },
    { key: 'hero', title: '헤더 상품 슬라이드' },
    { key: 'grid', title: '상품 그리드' },
    { key: 'md', title: 'MD 추천' },
  ]

  function saved(title: string): void {
    csToast.success(`${title} 저장되었습니다.`)
  }
</script>

<SettingsPanel
  title="상품목록 설정"
  sections={SECTIONS}
  {initialSection}
  {onclose}
  onland={(key) => onland(key as ProductsSettingsSection)}
>
  {#snippet renderSection(key, title)}
    {#if key === 'categories'}
      <ProductCategoryModal {...categories} embedded onclose={() => saved(title)} />
    {:else if key === 'hero'}
      <ProductHeroModal {...hero} embedded onclose={() => saved(title)} />
    {:else if key === 'grid'}
      <ProductGridModal {...grid} embedded onclose={() => saved(title)} />
    {:else}
      <ProductMdPickModal {...md} embedded onclose={() => saved(title)} />
    {/if}
  {/snippet}
</SettingsPanel>
