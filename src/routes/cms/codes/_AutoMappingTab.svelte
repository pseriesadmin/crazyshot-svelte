<script lang="ts">
  import { enhance } from '$app/forms'
  import { fly } from 'svelte/transition'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { MappingGroup, MappingItem, TaxonomyCode, CodeFormat } from './+page.server'
  import { ROOT_COLORS, buildPreview } from './_shared'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  // ── 상태 ─────────────────────────────────────────────────────────────
  let selectedId     = $state<string | null>(null)
  let showNewForm    = $state(false)
  let isEditMode     = $state(false)
  let showDelConfirm = $state(false)
  let pickerSearch   = $state('')
  let pickerTier     = $state<'major' | 'middle' | 'minor'>('major')
  // 현재 코드를 추가할 조합 행 ID (null = 새 조합 자동 생성)
  let activeComboId  = $state<string | null>(null)

  // 카테고리 키 정규화: 공백→하이픈, 10자 이내, 소문자 영문·숫자·_·- 만 허용
  function sanitizeCategoryKey(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 10)
  }
  function onNewCategoryInput(e: Event) {
    newDefaultCategory = sanitizeCategoryKey((e.target as HTMLInputElement).value)
  }
  function onEditCategoryInput(e: Event) {
    editDefaultCategory = sanitizeCategoryKey((e.target as HTMLInputElement).value)
  }

  // 신규 그룹 폼
  let newName = $state('')
  let newDesc = $state('')
  let newKwInput = $state('')
  let newKws = $state<string[]>([])
  let newOrder = $state('99')
  let newDefaultCategory = $state('')

  // 편집 폼
  let editName = $state('')
  let editDesc = $state('')
  let editKwInput = $state('')
  let editKws = $state<string[]>([])
  let editOrder = $state('99')
  let editDefaultCategory = $state('')

  // ── 파생 값 ──────────────────────────────────────────────────────────
  let selectedGroup = $derived(
    (data.mappingGroups ?? []).find((g: MappingGroup) => g.id === selectedId) ?? null
  )
  let panelOpen = $derived(!!selectedGroup)
  let selectedItems = $derived(
    (data.mappingItems ?? []).filter((i: MappingItem) => i.group_id === selectedId)
  )
  // 전체 포함 코드 (피커 행 배경 표시용)
  let selectedCodeIds = $derived(new Set(selectedItems.map((i: MappingItem) => i.taxonomy_code_id)))
  // 현재 활성 조합에 이미 있는 코드 (추가 버튼 비활성화용)
  let activeComboCodeIds = $derived(() =>
    new Set(selectedItems
      .filter(i => i.combo_row_id === activeComboId)
      .map(i => i.taxonomy_code_id))
  )

  // 아이템들을 combo_row_id 기준으로 그룹화 (대분류→중분류→소분류 정렬)
  const TIER_ORDER: Record<string, number> = { major: 0, middle: 1, minor: 2 }
  type ComboGroup = { combo_row_id: string; items: MappingItem[] }
  function combosForGroup(groupId: string): ComboGroup[] {
    const items = (data.mappingItems ?? []).filter((i: MappingItem) => i.group_id === groupId)
    const map = new Map<string, MappingItem[]>()
    for (const item of items) {
      const cid = item.combo_row_id
      if (!map.has(cid)) map.set(cid, [])
      map.get(cid)!.push(item)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([combo_row_id, comboItems]) => ({
      combo_row_id,
      items: [...comboItems].sort((a, b) => {
        const ta = (data.codes as TaxonomyCode[]).find(c => c.id === a.taxonomy_code_id)
        const tb = (data.codes as TaxonomyCode[]).find(c => c.id === b.taxonomy_code_id)
        const da = TIER_ORDER[ta?.code_tier ?? 'minor'] ?? 2
        const db = TIER_ORDER[tb?.code_tier ?? 'minor'] ?? 2
        return da - db
      })
    }))
  }

  let combos = $derived((): ComboGroup[] => selectedId ? combosForGroup(selectedId) : [])

  // 활성 코드만, deleted_at 제외
  let activeCodes = $derived(
    (data.codes as TaxonomyCode[]).filter(c => c.is_active && !c.deleted_at)
  )

  // 피커용 — tier별 필터 + 검색
  let filteredByTier = $derived(() => {
    const q = pickerSearch.trim().toLowerCase()
    return activeCodes.filter(c => {
      const tier = c.code_tier ?? (c.depth === 0 ? 'major' : c.depth === 1 ? 'middle' : 'minor')
      if (tier !== pickerTier) return false
      if (!q) return true
      return c.code.toLowerCase().includes(q) || c.name.includes(q)
    })
  })

  // 루트 컬러
  function rootColor(c: TaxonomyCode): string {
    const root = c.path_codes[0] ?? c.code
    return (ROOT_COLORS as Record<string, string>)[root] ?? '#888888'
  }

  // tier 한글
  const TIER_LABELS: Record<string, string> = { major: '대분류', middle: '중분류', minor: '소분류' }

  // 년월 옵션 레이블
  const DATE_OPT_LABEL: Record<string, string> = { none: '없음', ym: '년월', ymd: '년월' }

  function comboCatCode(items: MappingItem[]): string {
    return items
      .map(i => (data.codes as TaxonomyCode[]).find(c => c.id === i.taxonomy_code_id)?.code ?? '')
      .filter(Boolean)
      .join('')
      .toUpperCase()
  }

  function comboPreviewFmt(items: MappingItem[], lead: MappingItem): CodeFormat {
    const rootTc = items
      .map(i => (data.codes as TaxonomyCode[]).find(c => c.id === i.taxonomy_code_id))
      .find(Boolean)
    const rootRule = (rootTc?.code_rule as Record<string, unknown> | null) ?? null
    let date_format = data.codeFormat.date_format ?? 'YYMM'
    if (lead.date_option === 'none') date_format = 'NONE'
    else if (lead.date_option === 'ym') date_format = data.codeFormat.date_format ?? 'YYMM'
    else if (lead.date_option === 'ymd') date_format = data.codeFormat.date_format ?? 'YYMM'
    return {
      ...data.codeFormat,
      ...(rootRule?.prefix ? { prefix: rootRule.prefix as string } : {}),
      date_format,
      ...(lead.max_sequence ? { seq_digits: String(lead.max_sequence).length } : {}),
    }
  }

  function buildComboPreview(items: MappingItem[], lead: MappingItem): string {
    const catCode = comboCatCode(items)
    if (!catCode) return '—'
    const fmt = comboPreviewFmt(items, lead)
    return buildPreview(catCode, fmt)
  }

  // 조합행 코드명·키워드 임시 state (combo_row_id → 값)
  let comboKwsMap      = $state<Record<string, string[]>>({})
  let comboKwInMap     = $state<Record<string, string>>({})
  let comboNameMap     = $state<Record<string, string>>({})
  // 편집 모드 state
  let comboEditSet     = $state<Record<string, boolean>>({})
  let comboDateOptMap  = $state<Record<string, string>>({})
  let comboSeqMap      = $state<Record<string, string>>({})

  // 그룹 변경 시 임시 state 초기화
  $effect(() => {
    if (selectedId) {
      comboKwsMap = {}; comboKwInMap = {}; comboNameMap = {}
      comboEditSet = {}; comboDateOptMap = {}; comboSeqMap = {}
      activeComboId = null
    }
  })

  function getComboName(rowId: string, lead: MappingItem): string {
    return rowId in comboNameMap ? comboNameMap[rowId] : (lead.combo_name ?? '')
  }
  function getComboKws(rowId: string, lead: MappingItem): string[] {
    return rowId in comboKwsMap ? comboKwsMap[rowId] : (lead.combo_keywords ?? [])
  }
  function addComboKw(rowId: string, lead: MappingItem, input: string): { kws: string[]; cleared: boolean } {
    const kw = input.replace(/[^A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ@#%*]/g, '').trim()
    const cur = getComboKws(rowId, lead)
    if (!kw || cur.includes(kw) || cur.length >= 10) return { kws: cur, cleared: false }
    comboKwsMap = { ...comboKwsMap, [rowId]: [...cur, kw] }
    return { kws: comboKwsMap[rowId], cleared: true }
  }
  function removeComboKw(rowId: string, lead: MappingItem, kw: string) {
    comboKwsMap = { ...comboKwsMap, [rowId]: getComboKws(rowId, lead).filter(k => k !== kw) }
  }
  function enterComboEdit(rowId: string, lead: MappingItem) {
    comboEditSet    = { ...comboEditSet,    [rowId]: true }
    comboNameMap    = { ...comboNameMap,    [rowId]: lead.combo_name ?? '' }
    comboKwsMap     = { ...comboKwsMap,     [rowId]: [...(lead.combo_keywords ?? [])] }
    comboDateOptMap = { ...comboDateOptMap, [rowId]: lead.date_option }
    comboSeqMap     = { ...comboSeqMap,     [rowId]: String(lead.max_sequence ?? '') }
  }
  function exitComboEdit(rowId: string) {
    const e = { ...comboEditSet };    delete e[rowId];    comboEditSet    = e
    const n = { ...comboNameMap };    delete n[rowId];    comboNameMap    = n
    const k = { ...comboKwsMap };     delete k[rowId];    comboKwsMap     = k as Record<string, string[]>
    const d = { ...comboDateOptMap }; delete d[rowId];    comboDateOptMap = d
    const s = { ...comboSeqMap };     delete s[rowId];    comboSeqMap     = s
    const i = { ...comboKwInMap };    delete i[rowId];    comboKwInMap    = i
  }

  function cancelActiveCombo() {
    activeComboId = null
  }
  function startNewCombo() {
    activeComboId = globalThis.crypto.randomUUID()
  }

  // ── 그룹 편집 모드 진입 ───────────────────────────────────────────────
  function startEdit(g: MappingGroup) {
    editName            = g.name
    editDesc            = g.description ?? ''
    editKws             = [...g.keywords]
    editKwInput         = ''
    editOrder           = String(g.sort_order)
    editDefaultCategory = g.default_category ?? ''
    isEditMode          = true
  }
  function cancelEdit() { isEditMode = false }

  // 키워드 추가
  function addNewKw(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key !== 'Enter' && e.key !== ',') return
    e.preventDefault()
    const kw = newKwInput.trim()
    if (kw && !newKws.includes(kw)) newKws = [...newKws, kw]
    newKwInput = ''
  }
  function addEditKw(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key !== 'Enter' && e.key !== ',') return
    e.preventDefault()
    const kw = editKwInput.trim()
    if (kw && !editKws.includes(kw)) editKws = [...editKws, kw]
    editKwInput = ''
  }
  function removeNewKw(k: string)  { newKws  = newKws.filter(x => x !== k) }
  function removeEditKw(k: string) { editKws = editKws.filter(x => x !== k) }

  // ── form 결과 처리 ───────────────────────────────────────────────────
  $effect(() => {
    if (!form) return
    const f = form as { action?: string; success?: boolean; error?: string; id?: string }
    if (f.error) {
      csToast.error(f.error)
      return
    }
    if (!f.success) return

    switch (f.action) {
      case 'addGroup':
        csToast.success('매핑그룹이 추가되었습니다.')
        showNewForm = false
        newName = ''; newDesc = ''; newKws = []; newKwInput = ''; newOrder = '99'
        if (f.id) selectedId = f.id
        break
      case 'editGroup':
        csToast.success('그룹 정보가 저장되었습니다.')
        isEditMode = false
        break
      case 'deleteGroup':
        csToast.success('그룹이 삭제되었습니다.')
        selectedId = null; showDelConfirm = false
        break
      case 'toggleGroupActive':
        csToast.success('그룹 활성 상태가 변경되었습니다.')
        break
      case 'addGroupItem':
        csToast.success('코드가 추가되었습니다.')
        break
      case 'removeGroupItem':
        csToast.success('코드가 제거되었습니다.')
        break
      case 'removeComboItem':
        csToast.success('코드가 제거되었습니다.')
        break
      case 'removeGroupCombo':
        csToast.success('조합이 삭제되었습니다.')
        activeComboId = null
        break
      case 'updateGroupItemSettings':
        csToast.success('설정이 저장되었습니다.')
        break
    }
  })
</script>

<div class="am-root">

  <!-- 툴바 (상품목록 toolbar 위치) -->
  <div class="mapping-toolbar">
    <div class="left-header">
      <button class="btn-new" onclick={() => { showNewForm = !showNewForm; isEditMode = false }}>
        {showNewForm ? '✕ 취소' : '+ 그룹 추가'}
      </button>
    </div>

    {#if showNewForm}
      <form method="POST" action="?/addGroup" use:enhance class="new-group-form">
        <input class="ng-input ng-name" name="name" type="text" bind:value={newName}
          placeholder="그룹명 *" required maxlength="40" autocomplete="off" />
        <input class="ng-input ng-desc" name="description" type="text" bind:value={newDesc}
          placeholder="그룹 설명" maxlength="100" autocomplete="off" />
        <div class="kw-row ng-kw">
          {#each newKws as kw}
            <span class="kw-chip">
              {kw}
              <button type="button" class="kw-rm" onclick={() => removeNewKw(kw)} aria-label="키워드 삭제">×</button>
            </span>
          {/each}
          <input class="kw-input" type="text" bind:value={newKwInput}
            onkeydown={addNewKw} placeholder="키워드 입력 후 Enter" />
        </div>
        <input type="hidden" name="keywords" value={newKws.join(',')} />
        <input type="hidden" name="sort_order" value={newOrder} />
        <input class="ng-input ng-category" name="default_category" type="text" value={newDefaultCategory}
          oninput={onNewCategoryInput}
          placeholder="카테고리 키 (영문 10자, 예: camera)" maxlength="10" autocomplete="off" />
        <button type="submit" class="btn-save-group">그룹 추가</button>
      </form>
    {/if}
  </div>

  <div class="master-detail">
  <!-- 그룹 카드 목록 (선택 전: 가로 전체 / 선택 후: 좌측 420px) -->
  <div class="list-pane am-left" class:narrow={panelOpen}>
    <div class="group-list">
      {#each (data.mappingGroups ?? []) as group (group.id)}
        {@const groupCombos = combosForGroup(group.id)}
        <div
          class="group-card"
          class:group-card-selected={selectedId === group.id}
          class:group-card-inactive={!group.is_active}
          role="listitem"
        >
          <button
            class="gc-body"
            type="button"
            onclick={() => { selectedId = group.id; isEditMode = false; showNewForm = false }}
            aria-pressed={selectedId === group.id}
            aria-label={`${group.name} 상세 보기`}
          >
            <div class="gc-row">
              <div class="gc-name-group">
                <span class="gc-name">{group.name}</span>
                {#if !group.is_active}<span class="gc-badge inactive">비활성</span>{/if}
              </div>
              <div class="gc-combos">
                {#if groupCombos.length === 0}
                  <span class="gc-combo-empty">조합 없음</span>
                {:else}
                  {#each groupCombos as combo (combo.combo_row_id)}
                    {@const leadItem = combo.items[0]}
                    <span
                      class="gc-combo-preview"
                      title={buildComboPreview(combo.items, leadItem)}
                    >
                      {#each combo.items as item, i}
                        {@const tc = (data.codes as TaxonomyCode[]).find(c => c.id === item.taxonomy_code_id)}
                        {#if tc}
                          {#if i > 0}<span class="gc-combo-sep">+</span>{/if}
                          <span
                            class="gc-combo-code"
                            style="color:{rootColor(tc)}"
                          >{tc.code}</span>
                        {/if}
                      {/each}
                    </span>
                  {/each}
                {/if}
              </div>
            </div>
          </button>
          <div class="gc-actions">
            <form method="POST" action="?/toggleGroupActive" use:enhance class="gc-toggle-form">
              <input type="hidden" name="id" value={group.id} />
              <input type="hidden" name="is_active" value={String(group.is_active)} />
              <button
                type="submit"
                class="toggle"
                class:toggle-on={group.is_active}
                role="switch"
                aria-checked={group.is_active}
                aria-label={group.is_active ? '비활성화' : '활성화'}
                title={group.is_active ? '비활성화' : '활성화'}
              >
                <span class="toggle-thumb"></span>
              </button>
            </form>
          </div>
        </div>
      {:else}
        <div class="empty-hint">아직 매핑그룹이 없습니다.<br />위의 '+ 그룹 추가'로 생성하세요.</div>
      {/each}
    </div>
  </div>

  <!-- 그룹 상세 (선택 시 우측 패널) -->
  {#if selectedGroup}
    <div class="detail-pane am-right" transition:fly={{ x: 24, duration: 200 }}>
      <div class="group-detail-card">
      <!-- 그룹 헤더 -->
      <div class="detail-header">
        <div class="dh-left">
          {#if isEditMode}
            <span class="dh-title-editing">편집 중</span>
          {:else}
            <span class="dh-title">{selectedGroup.name}</span>
            {#if !selectedGroup.is_active}
              <span class="status-badge inactive">비활성</span>
            {:else}
              <span class="status-badge active">활성</span>
            {/if}
          {/if}
        </div>
        <div class="dh-actions">
          {#if !isEditMode}
            <form method="POST" action="?/toggleGroupProductFilter" use:enhance style="display:inline">
              <input type="hidden" name="id" value={selectedGroup.id} />
              <input type="hidden" name="show_in_product_filter" value={String(selectedGroup.show_in_product_filter)} />
              <button type="submit"
                class="btn-product-filter"
                class:active={selectedGroup.show_in_product_filter}
                title={selectedGroup.show_in_product_filter ? '상품목록 카테고리에서 제거' : '상품목록 카테고리에 노출'}
                aria-pressed={selectedGroup.show_in_product_filter}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                상품목록
              </button>
            </form>
            <form method="POST" action="?/toggleGroupPartnerType" use:enhance style="display:inline">
              <input type="hidden" name="id" value={selectedGroup.id} />
              <input type="hidden" name="is_partner_type" value={String(selectedGroup.is_partner_type)} />
              <button type="submit"
                class="btn-partner-type"
                class:active={selectedGroup.is_partner_type}
                title={selectedGroup.is_partner_type ? '협력사 전용코드 해제' : '협력사 전용코드로 지정'}
                aria-pressed={selectedGroup.is_partner_type}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                협력사 전용코드
              </button>
            </form>
            <button class="btn-icon" title="그룹 편집" onclick={() => startEdit(selectedGroup!)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <form method="POST" action="?/toggleGroupActive" use:enhance style="display:inline">
              <input type="hidden" name="id" value={selectedGroup.id} />
              <input type="hidden" name="is_active" value={String(selectedGroup.is_active)} />
              <button type="submit" class="toggle" class:toggle-on={selectedGroup.is_active}
                role="switch" aria-checked={selectedGroup.is_active}
                title={selectedGroup.is_active ? '비활성화' : '활성화'}>
                <span class="toggle-thumb"></span>
              </button>
            </form>
            <button class="btn-icon danger" title="그룹 삭제" onclick={() => showDelConfirm = true}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          {:else}
            <button class="btn-text" onclick={cancelEdit}>취소</button>
          {/if}
        </div>
      </div>

      <!-- 편집 폼 -->
      {#if isEditMode}
        <form method="POST" action="?/editGroup" use:enhance class="edit-form">
          <input type="hidden" name="id" value={selectedGroup.id} />
          <div class="ef-row">
            <label class="ef-label" for="ef-name">그룹명 *</label>
            <input id="ef-name" class="ef-input" name="name" type="text" bind:value={editName} required maxlength="40" autocomplete="off" />
          </div>
          <div class="ef-row">
            <label class="ef-label" for="ef-desc">설명</label>
            <input id="ef-desc" class="ef-input" name="description" type="text" bind:value={editDesc} maxlength="100" autocomplete="off" />
          </div>
          <div class="ef-row">
            <label class="ef-label" for="ef-kw-input">키워드</label>
            <div class="kw-row">
              {#each editKws as kw}
                <span class="kw-chip">
                  {kw}
                  <button type="button" class="kw-rm" onclick={() => removeEditKw(kw)} aria-label="키워드 삭제">×</button>
                </span>
              {/each}
              <input id="ef-kw-input" class="kw-input" type="text" bind:value={editKwInput} onkeydown={addEditKw} placeholder="Enter로 추가" />
            </div>
          </div>
          <input type="hidden" name="keywords" value={editKws.join(',')} />
          <div class="ef-row">
            <label class="ef-label" for="ef-order">정렬 순서</label>
            <input id="ef-order" class="ef-input ef-short" name="sort_order" type="number" bind:value={editOrder} min="0" max="999" />
          </div>
          <div class="ef-row">
            <label class="ef-label" for="ef-category">카테고리 키</label>
            <input id="ef-category" class="ef-input" name="default_category" type="text" value={editDefaultCategory}
              oninput={onEditCategoryInput}
              placeholder="카테고리 키 (영문 10자, 예: camera)" maxlength="10" autocomplete="off" />
          </div>
          <div class="ef-actions">
            <button type="submit" class="btn-primary">저장</button>
            <button type="button" class="btn-cancel" onclick={cancelEdit}>취소</button>
          </div>
        </form>
      {:else}
        <!-- 그룹 정보 요약 -->
        {#if selectedGroup.description || selectedGroup.keywords.length > 0 || selectedGroup.default_category}
          <div class="group-info">
            {#if selectedGroup.description}
              <p class="gi-desc">{selectedGroup.description}</p>
            {/if}
            {#if selectedGroup.default_category}
              <p class="gi-category">카테고리 키: <code>{selectedGroup.default_category}</code></p>
            {:else if selectedGroup.show_in_product_filter}
              <p class="gi-category gi-category-warn">⚠ 카테고리 키 미설정 — 상품필터에 노출되지 않음</p>
            {/if}
            {#if selectedGroup.keywords.length > 0}
              <div class="gi-kws">
                {#each selectedGroup.keywords as kw}
                  <span class="kw-chip kw-view">{kw}</span>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- ── 포함 코드 (조합 행 레이아웃) ─────────────────────────── -->
        <div class="section-block">
          <div class="section-label-row">
            <button
              type="button"
              class="btn-new-combo"
              class:btn-new-combo-active={activeComboId !== null}
              onclick={startNewCombo}
              title="새 조합 행 시작 — 이후 피커에서 선택한 코드들이 한 행에 모입니다"
            >
              {activeComboId ? '● 조합 중' : '+ 새 조합'}
            </button>
          </div>

          {#if combos().length === 0 && !activeComboId}
            <p class="empty-codes">아래 피커에서 '+ 새 조합' 후 코드를 추가하세요.</p>
          {:else}
            <div class="combo-rows">
              {#each combos() as combo (combo.combo_row_id)}
                {@const leadItem = combo.items[0]}
                {@const isActiveCurrent = activeComboId === combo.combo_row_id}
                <div class="combo-row" class:combo-row-active={isActiveCurrent}>

                  <!-- 코드 칩 목록 (대분류→중분류→소분류 순) -->
                  <div class="combo-chips">
                    {#if isActiveCurrent}
                      <span class="combo-building-badge">● 조합 중</span>
                    {/if}
                    {#each combo.items as item, i}
                      {@const tc = (data.codes as TaxonomyCode[]).find(c => c.id === item.taxonomy_code_id)}
                      {#if tc}
                        {#if i > 0}<span class="combo-sep">+</span>{/if}
                        {#if isActiveCurrent}
                          <form method="POST" action="?/removeComboItem" use:enhance class="chip-rm-form">
                            <input type="hidden" name="id" value={item.id} />
                            <button
                              type="submit"
                              class="combo-chip combo-chip-rm"
                              style="background:{rootColor(tc)}20; color:{rootColor(tc)}; border-color:{rootColor(tc)}60"
                              title="{tc.name} 제거"
                            >{tc.code} <span class="chip-rm-x">×</span></button>
                          </form>
                        {:else}
                          <span
                            class="combo-chip"
                            style="background:{rootColor(tc)}20; color:{rootColor(tc)}; border-color:{rootColor(tc)}40"
                            title="{tc.name} ({tc.code_tier ?? '미분류'})"
                          >{tc.code}</span>
                        {/if}
                      {/if}
                    {/each}
                    {#if combo.items.length === 1}
                      {@const singleTc = (data.codes as TaxonomyCode[]).find(c => c.id === combo.items[0].taxonomy_code_id)}
                      {#if singleTc}
                        <span class="combo-name">{singleTc.name}</span>
                      {/if}
                    {/if}
                  </div>

                  <!-- 우측 설정 영역 (조합 행 단위) -->
                  <div class="combo-controls">

                    {#if comboEditSet[combo.combo_row_id] || isActiveCurrent}
                      <!-- ── 메타 편집 모드 (✎ 버튼 진입) ── -->
                      <form
                        id="combo-form-{combo.combo_row_id}"
                        method="POST"
                        action="?/updateGroupItemSettings"
                        use:enhance={() => {
                          return async ({ result, update }) => {
                            await update()
                            if (result.type === 'success') {
                              exitComboEdit(combo.combo_row_id)
                              activeComboId = null
                            }
                          }
                        }}
                        class="combo-edit-form"
                      >
                        <input type="hidden" name="combo_row_id" value={combo.combo_row_id} />
                        <input type="hidden" name="group_id"     value={selectedGroup!.id} />
                        <input type="hidden" name="date_option"
                          value={comboDateOptMap[combo.combo_row_id] ?? leadItem.date_option} />
                        <input type="hidden" name="combo_keywords"
                          value={getComboKws(combo.combo_row_id, leadItem).join(',')} />

                        <!-- 날짜 옵션 토글 -->
                        <button
                          type="button"
                          class="date-toggle date-opt-{comboDateOptMap[combo.combo_row_id] ?? leadItem.date_option}"
                          onclick={() => {
                            const opts = ['none', 'ym']
                            const cur = comboDateOptMap[combo.combo_row_id] ?? leadItem.date_option
                            comboDateOptMap = { ...comboDateOptMap, [combo.combo_row_id]: opts[(opts.indexOf(cur) + 1) % 2] }
                          }}
                          title="클릭하여 변경: 없음 ↔ 년/월"
                        >년월</button>

                        <!-- 순번상한 -->
                        <div class="seq-wrap">
                          <input
                            type="number"
                            name="max_sequence"
                            class="seq-input"
                            value={comboSeqMap[combo.combo_row_id] ?? String(leadItem.max_sequence ?? '')}
                            min="1" max="9999999"
                            placeholder="순번상한"
                            oninput={(e) => { comboSeqMap = { ...comboSeqMap, [combo.combo_row_id]: (e.currentTarget as HTMLInputElement).value } }}
                            onfocus={(e) => (e.currentTarget.nextElementSibling as HTMLElement)?.classList.add('show')}
                            onblur={(e) => (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('show')}
                          />
                          <span class="seq-bubble">최대 백만자리 (9,999,999)</span>
                        </div>

                        <!-- 조합 이름 -->
                        <input
                          type="text"
                          name="combo_name"
                          class="combo-name-in"
                          value={getComboName(combo.combo_row_id, leadItem)}
                          maxlength="30"
                          placeholder="조합 이름"
                          aria-label="조합 이름"
                          oninput={(e) => { comboNameMap = { ...comboNameMap, [combo.combo_row_id]: (e.currentTarget as HTMLInputElement).value } }}
                        />

                        <!-- 키워드 태그 영역 -->
                        <div class="combo-kw-wrap">
                          {#each getComboKws(combo.combo_row_id, leadItem) as kw}
                            <span class="combo-kw-tag">
                              {kw}
                              <button
                                type="button"
                                class="combo-kw-del"
                                onclick={() => removeComboKw(combo.combo_row_id, leadItem, kw)}
                                aria-label="{kw} 키워드 제거"
                              >×</button>
                            </span>
                          {/each}
                          {#if getComboKws(combo.combo_row_id, leadItem).length < 10}
                            <input
                              class="combo-kw-in"
                              type="text"
                              maxlength="10"
                              placeholder="키워드"
                              aria-label="키워드 입력 후 Enter"
                              value={comboKwInMap[combo.combo_row_id] ?? ''}
                              oninput={(e) => { comboKwInMap = { ...comboKwInMap, [combo.combo_row_id]: (e.currentTarget as HTMLInputElement).value } }}
                              onkeydown={(e) => {
                                if (e.isComposing) return
                                if (e.key === 'Enter' || e.key === ',') {
                                  e.preventDefault()
                                  const res = addComboKw(combo.combo_row_id, leadItem, comboKwInMap[combo.combo_row_id] ?? '')
                                  if (res.cleared) comboKwInMap = { ...comboKwInMap, [combo.combo_row_id]: '' }
                                }
                              }}
                            />
                          {/if}
                        </div>

                        <!-- 저장 / 취소 -->
                        <button type="submit" class="btn-combo-save" title="변경사항 저장">저장</button>
                        <button type="button" class="btn-combo-cancel" onclick={() => { exitComboEdit(combo.combo_row_id); activeComboId = null }} title="편집 취소">취소</button>
                      </form>

                    {:else}
                      <!-- ── 일반 모드 ── -->
                      <!-- 날짜 옵션 배지 -->
                      <span class="date-badge date-opt-{leadItem.date_option}">년월</span>

                      <!-- 코드 프리뷰 -->
                      <code class="node-code-preview">{buildComboPreview(combo.items, leadItem)}</code>

                      <!-- 조합 이름 -->
                      {#if leadItem.combo_name}
                        <span class="combo-name-display">{leadItem.combo_name}</span>
                      {/if}

                      <!-- 키워드 (읽기 전용) -->
                      {#each (leadItem.combo_keywords ?? []) as kw}
                        <span class="combo-kw-tag-read">{kw}</span>
                      {/each}

                      <!-- 편집 버튼 (메타 편집 + 피커 동시 활성) -->
                      <button
                        type="button"
                        class="btn-combo-edit"
                        onclick={() => { enterComboEdit(combo.combo_row_id, leadItem); activeComboId = combo.combo_row_id }}
                        title="편집 (이름·날짜·순번·키워드·코드 추가)"
                        aria-label="편집"
                      >편집</button>
                    {/if}

                    <!-- 조합 전체 삭제 -->
                    <form method="POST" action="?/removeGroupCombo" use:enhance class="ctrl-form">
                      <input type="hidden" name="combo_row_id" value={combo.combo_row_id} />
                      <input type="hidden" name="group_id" value={selectedGroup!.id} />
                      <button type="submit" class="combo-rm" aria-label="조합 삭제">×</button>
                    </form>
                  </div> <!-- /combo-controls -->
                </div>
              {/each}

              <!-- 빈 조합 행: activeComboId가 새로 생성되었지만 아직 코드 미추가 -->
              {#if activeComboId && !combos().some(c => c.combo_row_id === activeComboId)}
                <div class="combo-row combo-row-active combo-row-pending">
                  <div class="combo-chips">
                    <span class="combo-pending-hint">← 아래 피커에서 코드를 선택하세요</span>
                  </div>
                  <button
                    type="button"
                    class="combo-rm"
                    onclick={cancelActiveCombo}
                    aria-label="새 조합 취소"
                  >×</button>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- ── 코드 선택 피커 (탭) ─────────────────────────────────── -->
        <div class="section-block picker-block">
          <div class="picker-header">
            <!-- 탭 -->
            <div class="picker-tabs">
              {#each (['major', 'middle', 'minor'] as const) as tier}
                <button
                  type="button"
                  class="picker-tab"
                  class:picker-tab-active={pickerTier === tier}
                  onclick={() => { pickerTier = tier; pickerSearch = '' }}
                >
                  {TIER_LABELS[tier]}
                </button>
              {/each}
            </div>
            <input
              class="picker-search"
              type="text"
              bind:value={pickerSearch}
              placeholder="코드·명칭 검색..."
            />
          </div>

          {#if activeComboId}
            <div class="picker-combo-hint">
              ● 조합 중 — 아래에서 코드를 선택하면 현재 조합에 추가됩니다.
              <button type="button" class="picker-combo-cancel" onclick={cancelActiveCombo}>취소</button>
            </div>
          {/if}

          <div class="picker-list">
            {#each filteredByTier() as tc (tc.id)}
              {@const inAnyCombo = selectedCodeIds.has(tc.id)}
              {@const inActiveCombo = activeComboId ? activeComboCodeIds().has(tc.id) : false}
              {@const included = activeComboId ? inActiveCombo : inAnyCombo}
              {@const color = rootColor(tc)}
              <div
                class="picker-row"
                class:picker-row-included={inAnyCombo}
                class:picker-row-clickable={!included}
                role={!included ? 'button' : undefined}
                tabindex={!included ? 0 : undefined}
                onclick={(e) => {
                  if (included) return
                  const form = (e.currentTarget as HTMLElement).querySelector('form') as HTMLFormElement
                  if (form) form.requestSubmit()
                }}
                onkeydown={(e) => {
                  if (included || (e.key !== 'Enter' && e.key !== ' ')) return
                  const form = (e.currentTarget as HTMLElement).querySelector('form') as HTMLFormElement
                  if (form) form.requestSubmit()
                }}
              >
                <span class="picker-dot" style="background:{color}"></span>
                <span class="picker-code" style="color:{color}">{tc.code}</span>
                <span class="picker-name">{tc.name}</span>
                {#if tc.path_codes.length > 1}
                  <span class="picker-path">{tc.path_codes.slice(0, -1).join(' › ')}</span>
                {/if}
                <div class="picker-actions" onclick={(e) => e.stopPropagation()}>
                  {#if included}
                    <form method="POST" action="?/removeGroupItem" use:enhance style="display:inline">
                      <input type="hidden" name="group_id" value={selectedGroup!.id} />
                      <input type="hidden" name="taxonomy_code_id" value={tc.id} />
                      <button type="submit" class="btn-picker-rm">제거</button>
                    </form>
                  {:else}
                    <form method="POST" action="?/addGroupItem" use:enhance style="display:inline">
                      <input type="hidden" name="group_id" value={selectedGroup!.id} />
                      <input type="hidden" name="taxonomy_code_id" value={tc.id} />
                      <input type="hidden" name="combo_row_id" value={activeComboId ?? ''} />
                      <button type="submit" class="btn-picker-add">추가</button>
                    </form>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="picker-empty">
                {pickerSearch ? '검색 결과가 없습니다.' : `등록된 ${TIER_LABELS[pickerTier]}가 없습니다.`}
              </div>
            {/each}
          </div>
        </div>
      {/if}
      </div>
    </div>
  {/if}
  </div>

</div>

<!-- 삭제 확인 모달 -->
{#if showDelConfirm && selectedGroup}
  <div class="confirm-backdrop" onclick={() => showDelConfirm = false} role="presentation">
    <div class="confirm-dialog" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <p class="confirm-msg">'{selectedGroup.name}' 그룹을 삭제할까요?</p>
      <p class="confirm-sub">그룹 내 코드 연결도 함께 삭제됩니다.</p>
      <div class="confirm-actions">
        <button class="btn-cancel" onclick={() => showDelConfirm = false}>취소</button>
        <form method="POST" action="?/deleteGroup" use:enhance style="display:inline">
          <input type="hidden" name="id" value={selectedGroup.id} />
          <button type="submit" class="btn-danger">삭제</button>
        </form>
      </div>
    </div>
  </div>
{/if}

<style>
/* ── 레이아웃 (상품목록 master-detail 패턴) ───────────────────────────── */
.am-root {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.master-detail {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

/* ── 그룹 목록 패널 (list-pane — 투명, 카드만 흰 배경) ───────────────── */
.am-left {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  transition: width 0.22s ease;
}
.am-left.narrow {
  width: 420px;
  flex: 0 0 420px;
}

.mapping-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.left-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0;
  flex-shrink: 0;
}

.btn-new {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 30px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--cs-purple);
  color: var(--cs-white);
  font: var(--text-pc-body-14);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}
.btn-new:hover { background: var(--cs-purple-hover); }

/* 신규 그룹 폼 — 한 행 인라인 레이아웃 */
.new-group-form {
  padding: 14px 16px;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  background: var(--cs-white);
  border-radius: var(--cms-radius-md);
  flex-shrink: 0;
}
.ng-input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  font: var(--text-pc-script-12);
  color: var(--cs-text);
  box-sizing: border-box;
  flex: 0 0 auto;
}
.new-group-form .ng-name { width: 160px; }
.new-group-form .ng-desc { width: 240px; }
.new-group-form .ng-category { width: 200px; }
.new-group-form .ng-kw {
  width: 320px;
  max-width: 320px;
  flex: 0 0 320px;
  min-width: 0;
  box-sizing: border-box;
}
.new-group-form .ng-kw:focus-within {
  outline: 2px solid var(--cs-purple);
  outline-offset: -2px;
  border-color: transparent;
}
.new-group-form .kw-input {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
  max-width: 100%;
}
.new-group-form .kw-input:focus,
.new-group-form .kw-input:focus-visible {
  outline: none;
  box-shadow: none;
}
.ng-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }

.btn-save-group {
  height: 34px;
  padding: 0 20px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--cs-purple);
  color: var(--cs-white);
  font: var(--text-pc-script-12);
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-save-group:hover { background: var(--cs-purple-hover); }

/* 그룹 카드 목록 (상품 card-list 동일) */
.group-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}

.group-card {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0;
  border: none;
  border-radius: var(--cms-radius-md);
  background: var(--cs-white);
  text-align: left;
  transition: background 0.12s;
  flex-shrink: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.group-card:hover { background: var(--cs-purple-op10); }
.group-card-selected { background: rgba(59,47,138,0.06); }
.group-card-inactive { opacity: 0.55; }

.gc-body {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  padding: 20px 12px 20px 30px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.gc-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 14px 0 8px;
}
.gc-toggle-form { display: flex; }

.gc-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  width: 100%;
  min-width: 0;
}
.gc-name-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
}
.gc-name {
  font: var(--text-pc-body-14);
  color: var(--cs-text);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gc-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12);
  flex-shrink: 0;
}
.gc-badge.inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }

/* 그룹 카드 — 조합 미리보기 (버튼형 칩) */
.gc-combos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
}
.gc-combo-preview {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  font: var(--text-pc-script-12);
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: 0.03em;
}
.gc-combo-code { white-space: nowrap; }
.gc-combo-sep {
  font-size: 11px;
  color: var(--cs-text-light);
  margin: 0 1px;
}
.gc-combo-empty {
  font: var(--text-pc-descript-10);
  color: var(--cs-text-light);
  white-space: nowrap;
}

.empty-hint {
  padding: 60px 20px;
  font: var(--text-pc-title-16);
  color: var(--cs-text-light);
  text-align: center;
  line-height: 1.6;
  background: var(--cs-white);
  border-radius: var(--cms-radius-md);
}

/* ── 그룹 상세 패널 ─────────────────────────────────────────────────── */
.detail-pane.am-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.group-detail-card {
  background: var(--cs-white);
  border-radius: var(--cms-radius-md);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  padding: 0 10px;
}

/* 상세 헤더 */
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  margin-top: 20px;
  flex-shrink: 0;
}
.dh-left { display: flex; align-items: center; gap: 8px; }
.dh-title { font: var(--text-pc-title-16); color: var(--cs-text); font-weight: 700; }
.dh-title-editing { font: var(--text-pc-body-14); color: var(--cs-text-mid); font-style: italic; }
.dh-actions { display: flex; align-items: center; gap: 8px; }

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12);
  font-weight: 700;
}
.status-badge.active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
.status-badge.inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px; height: 30px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  color: var(--cs-text-mid);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.btn-icon:hover { background: rgba(59,47,138,0.06); color: var(--cs-text); }
.btn-icon.danger:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

.btn-product-filter {
  display: inline-flex; align-items: center; gap: 4px;
  height: 30px; padding: 0 10px;
  background: var(--cs-surface-gray);
  color: var(--cs-text-mid);
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); font-weight: 700;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
}
.btn-product-filter:hover { background: rgba(59,47,138,0.06); color: var(--cs-purple); border-color: var(--cs-purple); }
.btn-product-filter.active {
  background: var(--cs-purple-op10);
  color: var(--cs-purple);
  border-color: var(--cs-purple);
}

.btn-partner-type {
  display: inline-flex; align-items: center; gap: 4px;
  height: 30px; padding: 0 10px;
  background: var(--cs-surface-gray);
  color: var(--cs-text-mid);
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); font-weight: 700;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
}
.btn-partner-type:hover { background: rgba(16,185,129,0.06); color: var(--cs-success-light); border-color: var(--cs-success-light); }
.btn-partner-type.active {
  background: rgba(16,185,129,0.10);
  color: var(--cs-success-light);
  border-color: var(--cs-success-light);
}

.btn-text {
  height: 30px; padding: 0 12px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  color: var(--cs-text-mid);
  font: var(--text-pc-script-12);
  cursor: pointer;
  transition: background 0.12s;
}
.btn-text:hover { background: rgba(59,47,138,0.06); }

/* 토글 스위치 */
.toggle {
  position: relative;
  width: 36px; height: 20px;
  border: none;
  border-radius: 10px;
  background: var(--cs-disabled-toggle);
  cursor: pointer;
  padding: 2px;
  transition: background 0.2s;
  flex-shrink: 0;
}
.toggle.toggle-on { background: var(--cs-purple); }
.toggle-thumb {
  position: absolute;
  top: 2px; left: 2px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: var(--cs-white);
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.toggle.toggle-on .toggle-thumb { transform: translateX(16px); }

/* 편집 폼 */
.edit-form {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ef-row { display: flex; align-items: flex-start; gap: 10px; }
.ef-label {
  width: 70px;
  flex-shrink: 0;
  padding-top: 9px;
  font: var(--text-pc-script-12);
  color: var(--cs-text-mid);
}
.ef-input {
  flex: 1;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  font: var(--text-pc-script-12);
  color: var(--cs-text);
}
.ef-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
.ef-short { flex: 0 0 80px; }
.ef-actions { display: flex; gap: 8px; padding-top: 4px; }

/* 그룹 정보 */
.group-info {
  padding: 12px 18px;
}
.group-info + .section-block {
  margin-top: 20px;
}
.gi-desc { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 8px; }
.gi-kws  { display: flex; flex-wrap: wrap; gap: 5px; }
.gi-category { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 8px; }
.gi-category code { font-family: monospace; background: var(--cs-lilac); padding: 1px 6px; border-radius: 4px; color: var(--cs-purple); }
.gi-category-warn { color: var(--cs-warning); }

/* 키워드 칩 */
.kw-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 4px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  min-height: 34px;
  background: var(--cs-white);
}
.kw-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  background: var(--cs-lilac);
  color: var(--cs-purple);
  border-radius: 4px;
  font: var(--text-pc-script-12);
  font-weight: 700;
}
.kw-view { background: var(--cs-purple-op10); }
.kw-rm {
  background: none; border: none; cursor: pointer;
  color: var(--cs-purple); font-size: 13px; line-height: 1; padding: 0;
}
.kw-input {
  flex: 1;
  min-width: 80px;
  border: none; outline: none;
  font: var(--text-pc-script-12);
  color: var(--cs-text);
  background: transparent;
}

/* ── 섹션 공통 ──────────────────────────────────────────────────────── */
.section-block {
  padding: 12px 18px;
}
.section-block + .section-block {
  margin-top: 20px;
}
.section-label-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 20px;
}
.empty-codes { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }

/* 새 조합 버튼 (상품상세 status-cta-btn 동일 토큰) */
.btn-new-combo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 35px;
  padding: 0 16px;
  background: var(--cs-purple);
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12);
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-new-combo:hover { background: var(--cs-purple-hover); }
.btn-new-combo-active {
  background: var(--cs-purple);
  color: var(--cs-white);
}
.btn-new-combo-active:hover { background: var(--cs-purple-hover); }

/* ── 포함 코드 조합 행 ──────────────────────────────────────────────── */
/* 완료 / + 버튼 (우측 × 좌측) */

/* 메타 편집 전용 버튼 (✎ / 저장 / 취소) */
.btn-combo-edit {
  height: 26px;
  padding: 0 10px;
  border: 1px solid rgba(59,47,138,0.30);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--cs-purple);
  font: var(--text-pc-descript-10);
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s;
}
.btn-combo-edit:hover { background: rgba(59,47,138,0.08); }

.btn-combo-save {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--cs-purple);
  color: var(--cs-white);
  font: var(--text-pc-descript-10);
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s;
}
.btn-combo-save:hover { background: var(--cs-purple-hover); }

.btn-combo-cancel {
  height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(59,47,138,0.20);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--cs-text-mid);
  font: var(--text-pc-descript-10);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s;
}
.btn-combo-cancel:hover { background: rgba(59,47,138,0.06); color: var(--cs-text); }

.combo-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.combo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: none;
  border-radius: var(--cms-radius-sm);
  background: var(--cs-lilac);
  min-height: 44px;
  transition: background 0.1s;
}
.combo-row:hover { background: var(--cs-purple-op10); }
.combo-row-active { background: var(--cs-purple-op10) !important; }

/* 코드 칩 영역 */
.combo-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.combo-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 9px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12);
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: 0.03em;
}

/* 조합 중 모드 칩 제거 버튼 */
.chip-rm-form { display: contents; }
.combo-chip-rm {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: opacity 0.1s, filter 0.1s;
}
.combo-chip-rm:hover { filter: brightness(0.85); opacity: 0.85; }
.chip-rm-x {
  font-size: 12px;
  opacity: 0.7;
  line-height: 1;
}

.combo-sep {
  font-size: 13px;
  color: var(--cs-text-light);
  margin: 0 1px;
}

.combo-name {
  font: var(--text-pc-descript-10);
  color: var(--cs-text-mid);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

/* 우측 컨트롤 영역 */
.combo-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex: 0 1 auto;
  max-width: 70%;
}

/* 폼 — flex item처럼 동작 */
.ctrl-form {
  display: contents;
}

/* 년월 토글 버튼 */
.date-toggle {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  min-width: 48px;
  text-align: center;
}
/* 없음 */
.date-opt-none {
  background: var(--cs-surface-gray);
  color: var(--cs-text-mid);
  border-color: #ECEBF4;
}
.date-opt-none:hover { background: #ededf5; border-color: rgba(59,47,138,0.2); }
/* 연월 */
.date-opt-ym {
  background: rgba(59,47,138,0.08);
  color: var(--cs-purple);
  border-color: rgba(59,47,138,0.2);
}
.date-opt-ym:hover { background: rgba(59,47,138,0.14); }
/* 연월일 */
.date-opt-ymd {
  background: var(--cs-purple);
  color: var(--cs-white);
  border-color: var(--cs-purple);
}
.date-opt-ymd:hover { background: var(--cs-purple-hover); border-color: var(--cs-purple-hover); }

/* 순번상한 입력 */
.seq-input {
  height: 28px;
  width: 72px;
  padding: 0 8px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  font: var(--text-pc-script-12);
  color: var(--cs-text);
  text-align: right;
}
.seq-input::placeholder { color: var(--cs-text-light); text-align: left; font-size: 10px; }
.seq-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }

/* 순번 버블 가이드 */
.seq-wrap { position: relative; display: flex; flex-direction: column; }
.seq-bubble {
  display: none;
  position: absolute; top: calc(100% + 5px); left: 0;
  background: var(--cs-purple-dark); color: var(--cs-white);
  font: var(--text-pc-script-12); white-space: nowrap;
  padding: 4px 10px; border-radius: var(--radius-sm);
  pointer-events: none; z-index: 10;
}
.seq-bubble::before {
  content: ''; position: absolute; bottom: 100%; left: 12px;
  border: 5px solid transparent; border-bottom-color: var(--cs-purple-dark);
}
.seq-bubble.show { display: block; }

.node-code-preview {
  font: var(--text-pc-script-12); font-weight: 700; letter-spacing: 0.07em;
  color: var(--cs-text-dark); background: var(--cs-surface-gray);
  padding: 2px 8px; border-radius: var(--radius-sm); white-space: nowrap; font-family: monospace;
  flex-shrink: 0;
}

/* 편집 모드 폼 — flex item */
.combo-edit-form {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

/* 일반 모드: 날짜 배지 (읽기 전용) */
.date-badge {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12);
  font-weight: 700;
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* 일반 모드: 조합 이름 텍스트 */
.combo-name-display {
  font: var(--text-pc-script-12);
  color: var(--cs-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
  flex-shrink: 1;
}

/* 일반 모드: 키워드 (읽기 전용 칩) */
.combo-kw-tag-read {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  background: rgba(59,47,138,0.08);
  color: var(--cs-purple);
  font: var(--text-pc-descript-10);
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 조합 이름 입력 */
.combo-name-in {
  height: 28px;
  width: 110px;
  flex-shrink: 0;
  padding: 0 8px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  font: var(--text-pc-script-12);
  color: var(--cs-text);
}
.combo-name-in::placeholder { color: var(--cs-text-light); }
.combo-name-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }

/* 키워드 태그 래퍼 */
.combo-kw-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 80px;
  max-width: 240px;
  padding: 2px 6px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  min-height: 28px;
  cursor: text;
}
.combo-kw-wrap:focus-within { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }

/* 키워드 태그 칩 */
.combo-kw-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(59,47,138,0.08);
  color: var(--cs-purple);
  font: var(--text-pc-descript-10);
  font-weight: 700;
  white-space: nowrap;
}
.combo-kw-del {
  border: none;
  background: none;
  color: var(--cs-purple);
  font-size: 10px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  opacity: 0.6;
}
.combo-kw-del:hover { opacity: 1; }

/* 키워드 입력 필드 */
.combo-kw-in {
  border: none;
  outline: none;
  background: transparent;
  font: var(--text-pc-descript-10);
  color: var(--cs-text);
  min-width: 50px;
  width: auto;
  height: 18px;
}
.combo-kw-in::placeholder { color: var(--cs-text-light); }

/* 조합 중 배지 */
.combo-building-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  background: var(--cs-purple);
  color: var(--cs-white);
  font: var(--text-pc-descript-10);
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
  letter-spacing: 0.02em;
}

/* 빈 조합 행 힌트 텍스트 */
.combo-row-pending { opacity: 0.85; }
.combo-pending-hint {
  font: var(--text-pc-script-12);
  color: var(--cs-purple);
  opacity: 0.7;
  font-style: italic;
}

/* 제거 버튼 */
.combo-rm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px; height: 24px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--cs-text-light);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.combo-rm:hover { background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }

/* ── 코드 선택 피커 ─────────────────────────────────────────────── */
.picker-block {
  margin-top: 20px;
  margin-bottom: 20px;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 12px;
}

/* 피커 탭 */
.picker-tabs {
  display: flex;
  gap: 2px;
}
.picker-tab {
  height: 30px;
  padding: 0 14px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  color: var(--cs-text-mid);
  font: var(--text-pc-script-12);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.picker-tab:hover { background: rgba(59,47,138,0.05); color: var(--cs-text); }
.picker-tab-active {
  background: var(--cs-purple-dark);
  color: var(--cs-white);
  border-color: var(--cs-purple-dark);
  font-weight: 700;
}

.picker-search {
  height: 30px;
  padding: 0 10px;
  border: 1px solid #ECEBF4;
  border-radius: var(--radius-sm);
  background: var(--cs-white);
  font: var(--text-pc-script-12);
  color: var(--cs-text);
  width: 180px;
}
.picker-search:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

.picker-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  transition: background 0.1s;
}
.picker-row:hover { background: rgba(59,47,138,0.03); }
.picker-row-included { background: rgba(59,47,138,0.04); }
.picker-row-clickable { cursor: pointer; }
.picker-row-clickable:hover { background: rgba(59,47,138,0.07); }

.picker-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.picker-code { font: var(--text-pc-script-12); font-weight: 700; min-width: 55px; }
.picker-name { font: var(--text-pc-script-12); color: var(--cs-text-dark); flex: 1; }
.picker-path { font: var(--text-pc-descript-10); color: var(--cs-text-light); }
.picker-actions { margin-left: auto; display: flex; gap: 4px; flex-shrink: 0; }

.btn-picker-add,
.btn-picker-rm {
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 4px;
  font: var(--text-pc-descript-10);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}
.btn-picker-add { background: rgba(59,47,138,0.08); color: var(--cs-purple); }
.btn-picker-add:hover { background: rgba(59,47,138,0.16); }
.btn-picker-rm  { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
.btn-picker-rm:hover  { background: rgba(255,53,53,0.16); }

.picker-empty { padding: 16px; font: var(--text-pc-script-12); color: var(--cs-text-light); text-align: center; }

/* 피커 조합 중 힌트 */
.picker-combo-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 6px;
  border-radius: var(--radius-sm);
  background: rgba(59,47,138,0.06);
  font: var(--text-pc-descript-10);
  color: var(--cs-purple);
  font-weight: 700;
}
.picker-combo-cancel {
  height: 22px; padding: 0 8px;
  border: 1px solid rgba(59,47,138,0.25);
  border-radius: 4px;
  background: var(--cs-white);
  color: var(--cs-purple);
  font: var(--text-pc-descript-10);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.picker-combo-cancel:hover { background: rgba(59,47,138,0.08); }

/* 공통 버튼 */
.btn-primary {
  height: 34px; padding: 0 16px;
  border: none; border-radius: var(--radius-sm);
  background: var(--cs-purple); color: var(--cs-white);
  font: var(--text-pc-body-14); cursor: pointer;
  transition: background 0.12s;
}
.btn-primary:hover { background: var(--cs-purple-hover); }
.btn-cancel {
  height: 34px; padding: 0 14px;
  border: 1px solid #ECEBF4; border-radius: var(--radius-sm);
  background: var(--cs-white); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); cursor: pointer;
  transition: background 0.12s;
}
.btn-cancel:hover { background: rgba(59,47,138,0.04); }

/* 삭제 확인 모달 */
.confirm-backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(16,11,50,0.45);
  display: flex; align-items: center; justify-content: center;
}
.confirm-dialog {
  background: var(--cs-white);
  border-radius: var(--cms-radius-lg);
  padding: 28px 32px;
  min-width: 320px; max-width: 400px;
  text-align: center;
}
.confirm-msg { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); margin: 0 0 6px; }
.confirm-sub { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0 0 20px; }
.confirm-actions { display: flex; gap: 8px; justify-content: center; }
.btn-danger {
  height: 34px; padding: 0 16px;
  border: none; border-radius: var(--radius-sm);
  background: var(--cs-chat-in-bg); color: var(--cs-red-badge);
  font: var(--text-pc-body-14); cursor: pointer;
  transition: background 0.12s;
}
.btn-danger:hover { background: #ffb3b3; }
</style>
