<script lang="ts">
  import CmsDashboardTabs from '$lib/components/cms/dashboard/CmsDashboardTabs.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()
</script>

<svelte:head><title>대시보드 — CrazyShot CMS</title></svelte:head>

<CmsDashboardTabs {data} />
