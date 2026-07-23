<script lang="ts">
  import ProductCategoryModal from './ProductCategoryModal.svelte'
  import ProductHeroModal from './ProductHeroModal.svelte'
  import ProductGridModal from './ProductGridModal.svelte'
  import ProductMdPickModal from './ProductMdPickModal.svelte'

  interface CategoryItem {
    id: string
    code: string
    name: string
    sort_order: number
    is_active?: boolean
  }

  interface Props {
    categories: CategoryItem[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: Record<string, any>
    activeModal: 'categories' | 'hero' | 'grid' | 'md_picks' | null
    onclose: () => void
  }

  let { categories, settings, activeModal, onclose }: Props = $props()
</script>

{#if activeModal === 'categories'}
  <ProductCategoryModal
    {categories}
    initialSettings={settings.categories}
    initialKeywordsSettings={settings.keywords}
    {onclose}
  />
{/if}
{#if activeModal === 'hero'}
  <ProductHeroModal
    settingKey="product_page_hero"
    initialSettings={settings.hero}
    {onclose}
  />
{/if}
{#if activeModal === 'grid'}
  <ProductGridModal
    {categories}
    initialSettings={settings.grid}
    {onclose}
  />
{/if}
{#if activeModal === 'md_picks'}
  <ProductMdPickModal
    initialSettings={settings.mdPicks}
    {onclose}
  />
{/if}
