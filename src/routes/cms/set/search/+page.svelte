<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { deserialize } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData } from './$types'
  import type { NlsearchParams } from '$lib/server/searchEngine/adapters/nlsearchParamsSchema'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

  const BOOST_LABELS: Record<string, string> = {
    name: '이름', brand: '브랜드', caption: '한 줄 설명', keywords_text: '키워드', components_text: '구성품',
    specs_text: '사양', content_text: '상세 설명', category: '분류 코드', reviews_text: '후기',
    compound_heads: '붙임말 끝말', category_label: '한글 분류 이름',
    title: '제목', tags_text: '태그', keyword_parts: '키워드 끝말',
  }

  // 편집용 사본 — 서버 값이 바뀌면(저장·복원 후) 다시 맞춘다(core-rules: $state(prop) 직접 초기화 금지)
  let draft = $state<NlsearchParams>(structuredClone(data.params))
  let reason = $state('')
  let saving = $state(false)
  let busyHistoryId = $state<number | null>(null)

  $effect(() => {
    draft = structuredClone(data.params)
  })

  const isDirty = $derived(JSON.stringify(draft) !== JSON.stringify(data.params))
  const isDefault = $derived(JSON.stringify(data.params) === JSON.stringify(data.defaults))

  function num(v: string, fallback: number): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }

  function outOfRange(v: number, min: number, max: number): boolean {
    return v < min || v > max
  }

  const hasError = $derived.by(() => {
    const r = data.ranges
    for (const g of [draft.product, draft.crazylog]) {
      if (outOfRange(g.fuzzy, r.fuzzy.min, r.fuzzy.max)) return true
      for (const v of Object.values(g.boost)) if (outOfRange(v, r.boost.min, r.boost.max)) return true
    }
    return outOfRange(draft.semantic.weight, r.semanticWeight.min, r.semanticWeight.max)
  })

  async function post(action: string, fd: FormData): Promise<string | null> {
    const res = await fetch(action, { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } })
    const result = deserialize(await res.text())
    if (result.type === 'success') return null
    if (result.type === 'failure') return (result.data as { message?: string } | undefined)?.message ?? '저장에 실패했습니다.'
    return '저장에 실패했습니다.'
  }

  async function save(): Promise<void> {
    if (!isDirty || hasError || saving) return
    saving = true
    const fd = new FormData()
    fd.set('params', JSON.stringify(draft))
    fd.set('reason', reason)
    try {
      const err = await post('?/save', fd)
      if (err) {
        csToast.error(err)
        return
      }
      csToast.success('검색 설정을 저장했습니다. 1~2분 안에 검색에 반영됩니다.')
      reason = ''
      await invalidateAll()
    } finally {
      saving = false
    }
  }

  async function restore(id: number): Promise<void> {
    if (busyHistoryId !== null) return
    busyHistoryId = id
    const fd = new FormData()
    fd.set('history_id', String(id))
    try {
      const err = await post('?/restore', fd)
      if (err) {
        csToast.error(err)
        return
      }
      csToast.success('선택한 값을 적용했습니다. 1~2분 안에 검색에 반영됩니다.')
      await invalidateAll()
    } finally {
      busyHistoryId = null
    }
  }

  function resetToDefaults(): void {
    draft = structuredClone(data.defaults)
  }

  const STATUS_LABEL: Record<string, string> = { applied: '적용', proposed: '제안', restored: '복원' }

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })
  }
</script>

<div class="page-wrap">
  <div class="sections">
    <section class="setting-section">
      <div class="section-header">
        <div class="section-head">
          <h2 class="section-title">검색 설정</h2>
          <span class="section-badge">v{data.version}{isDefault ? ' · 기본값' : ''}</span>
        </div>
        <button type="button" class="btn-save-inline" class:dirty={isDirty && !hasError} onclick={save} disabled={!isDirty || hasError || saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
      <p class="section-desc">
        칸별 가중치가 클수록 그 칸에서 일치한 상품이 검색 결과 앞에 옵니다. 값을 바꾸면 1~2분 안에 상품 검색·크레이지로그 검색에 반영됩니다.
        기본값은 현재 운영 중인 값과 같으며, 저장하지 않으면 검색 결과는 달라지지 않습니다.
      </p>

      {#each [{ key: 'product', title: '상품 검색', group: draft.product, def: data.defaults.product }, { key: 'crazylog', title: '크레이지로그 검색', group: draft.crazylog, def: data.defaults.crazylog }] as g (g.key)}
        <h3 class="group-title">{g.title}</h3>
        <div class="param-table">
          <div class="param-row param-head"><span>칸</span><span>값</span><span>기본값</span></div>
          {#each Object.keys(g.def.boost) as field (field)}
            <label class="param-row">
              <span class="param-name">{BOOST_LABELS[field] ?? field}<small>{field}</small></span>
              <input
                class="param-input"
                class:invalid={outOfRange(g.group.boost[field], data.ranges.boost.min, data.ranges.boost.max)}
                type="number"
                step="0.5"
                min={data.ranges.boost.min}
                max={data.ranges.boost.max}
                value={g.group.boost[field]}
                oninput={(e) => (g.group.boost[field] = num(e.currentTarget.value, g.def.boost[field]))}
              />
              <span class="param-def">{g.def.boost[field]}</span>
            </label>
          {/each}
          <label class="param-row">
            <span class="param-name">오타 허용 범위<small>fuzzy</small></span>
            <input
              class="param-input"
              class:invalid={outOfRange(g.group.fuzzy, data.ranges.fuzzy.min, data.ranges.fuzzy.max)}
              type="number"
              step="0.05"
              min={data.ranges.fuzzy.min}
              max={data.ranges.fuzzy.max}
              value={g.group.fuzzy}
              oninput={(e) => (g.group.fuzzy = num(e.currentTarget.value, g.def.fuzzy))}
            />
            <span class="param-def">{g.def.fuzzy}</span>
          </label>
          <label class="param-row">
            <span class="param-name">앞부분 일치 허용<small>prefix</small></span>
            <input type="checkbox" class="param-check" checked={g.group.prefix} onchange={(e) => (g.group.prefix = e.currentTarget.checked)} />
            <span class="param-def">{g.def.prefix ? '켜짐' : '꺼짐'}</span>
          </label>
        </div>
      {/each}

      <h3 class="group-title">의미 점수 (준비 중)</h3>
      <p class="section-desc">뜻이 가까운 말을 찾는 기능입니다. 의미 점수 비중은 아직 검색 결과에 쓰이지 않습니다. '관찰 기록'을 켜면 검색 결과는 그대로 두고, 의미 점수를 썼다면 상위 결과가 얼마나 달라졌을지만 숫자로 기록합니다(질문 문장·상품명은 저장하지 않습니다).</p>
      <div class="param-table">
        <label class="param-row">
          <span class="param-name">의미 점수 비중<small>semantic.weight</small></span>
          <input
            class="param-input"
            class:invalid={outOfRange(draft.semantic.weight, data.ranges.semanticWeight.min, data.ranges.semanticWeight.max)}
            type="number"
            step="0.05"
            min={data.ranges.semanticWeight.min}
            max={data.ranges.semanticWeight.max}
            value={draft.semantic.weight}
            oninput={(e) => (draft.semantic.weight = num(e.currentTarget.value, 0))}
          />
          <span class="param-def">{data.defaults.semantic.weight}</span>
        </label>
        <label class="param-row">
          <span class="param-name">크레이지챗 추천에 사용<small>semantic.recommend</small></span>
          <input type="checkbox" class="param-check" checked={draft.semantic.recommend} onchange={(e) => (draft.semantic.recommend = e.currentTarget.checked)} />
          <span class="param-def">{data.defaults.semantic.recommend ? '켜짐' : '꺼짐'}</span>
        </label>
        <label class="param-row">
          <span class="param-name">관찰 기록(응답은 안 바뀜)<small>semantic.shadow</small></span>
          <input type="checkbox" class="param-check" checked={draft.semantic.shadow} onchange={(e) => (draft.semantic.shadow = e.currentTarget.checked)} />
          <span class="param-def">{data.defaults.semantic.shadow ? '켜짐' : '꺼짐'}</span>
        </label>
      </div>

      <div class="foot-row">
        <input class="reason-input" type="text" maxlength="200" placeholder="변경 사유(선택, 이력에 남습니다)" bind:value={reason} />
        <button type="button" class="btn-row" onclick={resetToDefaults}>기본값으로 채우기</button>
      </div>
      {#if hasError}
        <p class="error-bar" role="alert">허용 범위를 벗어난 값이 있어 저장할 수 없습니다.</p>
      {/if}
    </section>

    <section class="setting-section">
      <div class="section-head">
        <h2 class="section-title">변경 이력</h2>
        <span class="section-badge">최근 {data.history.length}건</span>
      </div>
      <p class="section-desc">'제안'은 튜닝 도구가 평가 결과를 바탕으로 남긴 값입니다. 자동으로 적용되지 않으며 [적용]을 눌러야 반영됩니다.</p>
      {#if data.history.length === 0}
        <p class="no-data">아직 변경 이력이 없습니다.</p>
      {:else}
        <div class="history-list">
          {#each data.history as h (h.id)}
            <div class="history-row">
              <span class="history-ver">v{h.version}</span>
              <span class="history-status history-status--{h.status}">{STATUS_LABEL[h.status] ?? h.status}</span>
              <span class="history-time">{fmt(h.created_at)}</span>
              <span class="history-reason">{h.reason ?? ''}</span>
              <button type="button" class="btn-row" disabled={busyHistoryId !== null} onclick={() => restore(h.id)}>
                {h.status === 'proposed' ? '적용' : '이 값으로 복원'}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .page-wrap { flex: 1; overflow-y: auto; padding: 32px 16px; min-width: 0; }
  .sections { display: flex; flex-direction: column; gap: 32px; }
  .setting-section { background: var(--cs-white); border-radius: var(--cms-radius-lg); padding: 34px 32px; }

  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .section-header .section-head { margin-bottom: 0; }
  .section-title { font: var(--text-pc-menu-kr-20); color: var(--cs-dark); margin: 0; }
  .section-badge {
    background: var(--cs-lilac); color: var(--cs-purple); font: var(--text-pc-body-14); font-weight: 700;
    padding: 2px 10px; border-radius: var(--radius-full); white-space: nowrap;
  }
  .section-desc { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0 0 24px; }
  .group-title { font: var(--text-pc-title-16); color: var(--cs-text); margin: 24px 0 10px; }

  /* cms-uiux.md §0-10-D 섹션 인라인 저장 버튼 */
  .btn-save-inline {
    padding: 5px 14px; border: 1.5px solid var(--cs-border); border-radius: var(--radius-sm);
    background: transparent; color: var(--cs-text-light); font: var(--text-pc-script-12);
    cursor: not-allowed; min-height: 32px; transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .btn-save-inline.dirty { border-color: var(--cs-purple); background: var(--cs-purple); color: var(--cs-white); cursor: pointer; }
  .btn-save-inline.dirty:hover { opacity: 0.85; }

  .param-table { display: flex; flex-direction: column; gap: 6px; }
  .param-row {
    display: grid; grid-template-columns: 1fr 140px 90px; align-items: center; gap: 12px;
    padding: 10px 18px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14); color: var(--cs-text);
  }
  .param-head { background: transparent; color: var(--cs-text-mid); padding-top: 0; padding-bottom: 0; }
  .param-name { font-weight: 700; }
  .param-name small { margin-left: 8px; font-weight: 400; color: var(--cs-text-light); }
  .param-def { color: var(--cs-text-mid); text-align: right; }
  .param-input {
    height: 34px; padding: 0 10px; border: 1px solid var(--cs-lilac); border-radius: var(--radius-sm);
    background: var(--cs-white); font: var(--text-pc-body-14); color: var(--cs-text);
  }
  .param-input.invalid { border-color: var(--cs-red-badge); }
  .param-check { width: 20px; height: 20px; justify-self: start; }

  .foot-row { display: flex; gap: 10px; align-items: center; margin-top: 24px; }
  .reason-input {
    flex: 1; height: 40px; padding: 0 14px; border: 1px solid var(--cs-lilac); border-radius: var(--radius-sm);
    font: var(--text-pc-body-14); color: var(--cs-text);
  }
  .error-bar {
    background: var(--cs-bg-error); border-left: 3px solid var(--cs-red-badge); border-radius: var(--radius-sm);
    padding: 8px 12px; font: var(--text-m-script-12); color: var(--cs-error); margin-top: 12px;
  }
  .no-data { text-align: center; padding: 40px 20px; font: var(--text-m-script-14); color: var(--cs-text-light); }

  .history-list { display: flex; flex-direction: column; gap: 6px; }
  .history-row {
    display: grid; grid-template-columns: 56px 60px 140px 1fr auto; align-items: center; gap: 12px;
    padding: 10px 18px; background: var(--cs-surface-gray); border-radius: var(--cms-radius-sm); font: var(--text-pc-body-14);
  }
  .history-ver { font-weight: 700; color: var(--cs-text); }
  .history-time, .history-reason { color: var(--cs-text-mid); }
  .history-status { font-weight: 700; color: var(--cs-text-mid); }
  .history-status--proposed { color: var(--cs-purple); }

  /* cms-uiux.md §0-10-F DetailPanel 소형 실행 버튼 */
  .btn-row {
    min-width: 78px; text-align: center; flex-shrink: 0; font-size: 12px; font-weight: 700; line-height: 1.4; padding: 8px 14px;
    border: 1px solid var(--cs-text-mid); border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray); color: var(--cs-text-mid); cursor: pointer; white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .btn-row:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .btn-row:disabled { opacity: 0.5; cursor: default; }
</style>
