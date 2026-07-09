<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { TaxonomyMapping } from './+page.server'
  import { ROOT_COLORS, PRODUCT_CATS, buildPreview } from './_shared'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  function getMappedCodeId(category: string): string {
    return data.mappings.find((m: TaxonomyMapping) => m.product_category === category)?.taxonomy_code_id ?? ''
  }

  $effect(() => {
    if (!form) return
    const f = form as { action?: string; success?: boolean; error?: string }
    if (f.error) { csToast.error(f.error); return }
    if (!f.success || f.action !== 'saveMapping') return
    csToast.success('매핑이 저장되었습니다.')
  })
</script>

<div class="mapping-header">
  <div>
    <h2 class="mapping-title">상품 카테고리 → 분류코드 자동 매핑</h2>
    <p class="mapping-sub">상품 등록 시 카테고리에 따라 분류코드를 자동으로 제안합니다.</p>
  </div>
</div>

<div class="mapping-list">
  {#each PRODUCT_CATS as cat}
    {@const mappedId = getMappedCodeId(cat.value)}
    {@const mappedNode = data.codes.find(c => c.id === mappedId)}
    {@const color = mappedNode ? (ROOT_COLORS[mappedNode.path_codes[0]] ?? '#888') : undefined}
    <div class="mapping-row">
      <div class="mr-left">
        <div class="mr-cat-label">{cat.label}</div>
        <div class="mr-cat-code">{cat.value}</div>
      </div>
      <div class="mr-arrow">→</div>
      <form method="POST" action="?/saveMapping" use:enhance class="mr-form">
        <input type="hidden" name="product_category" value={cat.value} />
        <select
          class="mr-select"
          name="taxonomy_code_id"
          onchange={(e) => {
            const form = (e.target as HTMLSelectElement).closest('form') as HTMLFormElement
            form?.requestSubmit()
          }}
        >
          <option value="">매핑 없음</option>
          {#each data.codes.filter(c => c.is_active) as code}
            <option value={code.id} selected={code.id === mappedId}>
              {'  '.repeat(code.depth)}{code.depth > 0 ? '└ ' : ''}{code.code} — {code.name}
            </option>
          {/each}
        </select>
      </form>
      <div class="mr-preview">
        {#if mappedNode}
          <span class="code-badge" style="--bc:{color}">{mappedNode.code}</span>
          <span class="mr-preview-name">{mappedNode.name}</span>
          {@const mappedRule = mappedNode.code_rule as Record<string,unknown> | null}
          {@const mappedFmt = mappedRule?.date_format === 'NONE' ? { ...data.codeFormat, date_format: 'NONE' as 'YYMM' } : data.codeFormat}
          <code class="mr-preview-code">{buildPreview(mappedNode.code, mappedFmt)}</code>
        {:else}
          <span class="no-data">매핑 없음</span>
        {/if}
      </div>
    </div>
  {/each}
</div>

<div class="mapping-footer">
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  선택 즉시 자동 저장됩니다. 상품 등록 시 해당 카테고리의 매핑 코드가 기본값으로 제안됩니다.
</div>

<style>
.mapping-header { padding: 18px 22px 14px; border-bottom: 1px solid rgba(59,47,138,0.06); }
.mapping-title  { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0 0 2px; }
.mapping-sub    { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

.mapping-list { display: flex; flex-direction: column; }
.mapping-row {
  display: flex; align-items: center; gap: 16px; padding: 13px 22px;
  border-bottom: 1px solid rgba(59,47,138,0.04); transition: background 0.08s;
  flex-wrap: wrap;
}
.mapping-row:hover { background: rgba(236,235,244,0.3); }
.mapping-row:last-child { border-bottom: none; }

.mr-left { min-width: 100px; }
.mr-cat-label { font: var(--text-pc-body-14); color: var(--cs-text); }
.mr-cat-code  { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin-top: 1px; }
.mr-arrow { font: var(--text-pc-title-16); color: var(--cs-text-light); flex-shrink: 0; }
.mr-form { flex-shrink: 0; }
.mr-select {
  height: 36px; padding: 0 32px 0 10px; border: 1.5px solid rgba(59,47,138,0.12);
  border-radius: var(--radius-sm); background: var(--cs-surface-gray);
  font: var(--text-pc-body-14); color: var(--cs-text); cursor: pointer; min-width: 220px;
  -webkit-appearance: none; -moz-appearance: none; appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpolyline points='6,9 12,15 18,9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}
.mr-select:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
.mr-preview { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mr-preview-name { font: var(--text-pc-body-14); color: var(--cs-text-mid); }
.mr-preview-code { font: var(--text-pc-script-12); color: var(--cs-text-dark); background: var(--cs-surface-gray); padding: 3px 8px; border-radius: var(--radius-sm); }

.mapping-footer {
  display: flex; align-items: center; gap: 5px; padding: 10px 22px;
  font: var(--text-pc-script-12); color: var(--cs-text-light);
  border-top: 1px solid rgba(59,47,138,0.06);
}

/* 공유 - code-badge, no-data */
.code-badge {
  display: inline-block; padding: 3px 9px;
  background: var(--bc, var(--cs-dark)); color: var(--cs-white);
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); font-weight: 700;
  letter-spacing: 0.06em;
}
.no-data { font: var(--text-pc-script-12); color: var(--cs-text-light); }
</style>
