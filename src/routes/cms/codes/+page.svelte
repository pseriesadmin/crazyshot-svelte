<script lang="ts">
  import type { PageData, ActionData } from './$types'
  import TreeTab    from './_TreeTab.svelte'
  import FormatTab  from './_FormatTab.svelte'
  import AutoMappingTab from './_AutoMappingTab.svelte'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  type Tab = 'tree' | 'format' | 'mapping'
  let activeTab = $state<Tab>('tree')
  let fmtDirty  = $state(false)

  function tierOf(c: { code_tier: string | null; depth: number }): 'major' | 'middle' | 'minor' {
    if (c.code_tier === 'major' || c.code_tier === 'middle' || c.code_tier === 'minor') return c.code_tier
    return c.depth === 0 ? 'major' : c.depth === 1 ? 'middle' : 'minor'
  }

  let stats = $derived({
    major:    data.codes.filter(c => tierOf(c) === 'major').length,
    middle:   data.codes.filter(c => tierOf(c) === 'middle').length,
    minor:    data.codes.filter(c => tierOf(c) === 'minor').length,
    total:    data.codes.length,
    active:   data.codes.filter(c => c.is_active).length,
    inactive: data.codes.filter(c => !c.is_active).length,
  })

  let groupStats = $derived({
    total:    (data.mappingGroups ?? []).length,
    active:   (data.mappingGroups ?? []).filter(g => g.is_active).length,
    inactive: (data.mappingGroups ?? []).filter(g => !g.is_active).length,
  })
</script>

<svelte:head><title>분류체계 코드 — CrazyShot CMS</title></svelte:head>

<div class="root">

  <!-- 헤더: 탭 + 통계 -->
  <div class="page-header">
    <div class="tab-bar">
      <button class="tab-btn" class:tab-active={activeTab==='tree'} onclick={() => activeTab='tree'}>
        코드목록
      </button>
      <button class="tab-btn" class:tab-active={activeTab==='mapping'} onclick={() => activeTab='mapping'}>
        코드조합
      </button>
      <button class="tab-btn" class:tab-active={activeTab==='format'} onclick={() => activeTab='format'}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 2v4M16 2v4M2 10h20"/></svg>
        예약코드 형식
        {#if fmtDirty}<span class="dirty-dot"></span>{/if}
      </button>
    </div>
    <div class="stat-row">
      <div class="stat group-stat" title="매핑그룹 전체 {groupStats.total} · 활성 {groupStats.active} · 비활성 {groupStats.inactive}">
        <span class="sv">{groupStats.total}</span>
        <span class="sl">그룹</span>
      </div>
      <div class="stat"><span class="sv">{stats.major}</span><span class="sl">대분류</span></div>
      <div class="stat"><span class="sv">{stats.middle}</span><span class="sl">중분류</span></div>
      <div class="stat"><span class="sv">{stats.minor}</span><span class="sl">소분류</span></div>
      <div class="stat"><span class="sv">{stats.total}</span><span class="sl">전체</span></div>
      <div class="stat green"><span class="sv">{stats.active}</span><span class="sl">활성</span></div>
      <div class="stat dim"><span class="sv">{stats.inactive}</span><span class="sl">비활성</span></div>
    </div>
  </div>

  <!-- 탭 패널 -->
  {#if activeTab === 'tree'}
    <div class="panel">
      <TreeTab {data} {form} />
    </div>
  {:else if activeTab === 'format'}
    <div class="panel">
      <FormatTab {data} {form} bind:dirty={fmtDirty} />
    </div>
  {:else}
    <div class="mapping-wrap">
      <AutoMappingTab {data} {form} />
    </div>
  {/if}

</div>

<style>
.root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 페이지 헤더 — 탭(좌) + 통계(우) */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 24px 14px;
  flex-shrink: 0;
}

/* 통계 행 */
.stat-row {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 14px;
  background: var(--cs-white);
  border-radius: var(--cms-radius-sm);
  min-width: 60px;
  border: 1px solid #ECEBF4;
}
.stat.green .sv { color: var(--cs-success-light); }
.stat.dim   .sv { color: var(--cs-text-light); }
.stat.group-stat .sv { color: var(--cs-purple); }
.sv { font: var(--text-pc-title-18); color: var(--cs-text); }
.sl { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin-top: 1px; }

/* 탭 바 */
.tab-bar {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--cs-text-mid);
  font: var(--text-pc-body-14);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  position: relative;
}
.tab-btn:hover    { background: rgba(59,47,138,0.06); color: var(--cs-text); }
.tab-active       { background: var(--cs-white); color: var(--cs-purple); }
.tab-active:hover { background: var(--cs-white); }

/* 미저장 변경 dot */
.dirty-dot {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--cs-orange);
  margin-left: 2px;
}

/* 탭 패널 */
.panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--cms-radius-md);
  border: 1px solid #ECEBF4;
  box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
  margin: 0 0 4px;
}
/* 매핑 탭 — 코드목록 .panel + .toolbar(14px 18px) 여백과 동일 */
.mapping-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 14px 18px 20px;
  margin: 0 0 4px;
}
</style>
