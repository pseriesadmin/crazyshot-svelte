<script lang="ts">
  /**
   * 검색·AI 검색·공유 카드용 head — canonical + og:* + twitter:* (2026-10-28)
   * title·description은 각 페이지가 자기 <svelte:head>에서 넣는다(pageMeta.ts) — 여기서는 중복해서 넣지 않는다.
   */
  import { buildSeoTags } from '$lib/utils/seoMeta'

  interface Props {
    title: string
    description: string
    /** 이 페이지의 정식 경로(예: '/products/sony-np-f770-2609') — 쿼리·해시는 무시 */
    path: string
    image?: string | null
    type?: string
  }

  let { title, description, path, image = null, type = 'website' }: Props = $props()

  const tags = $derived(buildSeoTags({ title, description, path, image, type }))
</script>

<svelte:head>
  <link rel="canonical" href={tags.canonical} />
  {#each Object.entries(tags.og) as [key, value] (key)}
    <meta property={`og:${key}`} content={value} />
  {/each}
  {#each Object.entries(tags.twitter) as [key, value] (key)}
    <meta name={`twitter:${key}`} content={value} />
  {/each}
</svelte:head>
