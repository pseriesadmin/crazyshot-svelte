<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { TaxonomyCode, TaxonomyMapping } from './+page.server'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  // ── 트리 노드 타입 ──────────────────────────────────────────────────
  type TreeNode = TaxonomyCode & { children: TreeNode[] }

  // ── 루트 컬러 팔레트 (대분류별 고정) ──────────────────────────────
  const ROOT_COLORS: Record<string, string> = {
    CAM: '#FF4500', OPT: '#3B2F8A', LGT: '#F59E0B', AUD: '#0EA5E9',
    SPT: '#10B981', MON: '#6366F1', PWR: '#EC4899', MED: '#8B5CF6',
    STD: '#14B8A6', VID: '#F97316', ACC: '#84CC16', PKG: '#06B6D4',
  }
  function nodeColor(node: TreeNode): string {
    const root = node.path_codes[0] ?? node.code
    return ROOT_COLORS[root] ?? '#888'
  }

  // ── 트리 빌드 ──────────────────────────────────────────────────────
  let treeRoots = $derived.by((): TreeNode[] => {
    const map = new Map<string, TreeNode>()
    for (const c of data.codes) map.set(c.id, { ...c, children: [] })
    const roots: TreeNode[] = []
    for (const c of data.codes) {
      const node = map.get(c.id)!
      if (c.parent_id && map.has(c.parent_id)) {
        map.get(c.parent_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    }
    return roots
  })

  // ── 전체 노드 수 카운트 ────────────────────────────────────────────
  let stats = $derived({
    roots:    treeRoots.length,
    total:    data.codes.length,
    active:   data.codes.filter(c => c.is_active).length,
    inactive: data.codes.filter(c => !c.is_active).length,
  })

  // ── 탭 ─────────────────────────────────────────────────────────────
  type Tab = 'tree' | 'format' | 'mapping'
  let activeTab = $state<Tab>('tree')

  // ── 트리 UI 상태 ───────────────────────────────────────────────────
  // 초기: 대분류만 펼침 (depth=0 노드 ID 전체)
  let expanded = $state(new Set(data.codes.filter(c => c.depth === 0).map(c => c.id)))
  let editingId      = $state<string | null>(null)
  let addingParentId = $state<string | null>(null)   // null = 루트 추가

  // 편집 폼 상태
  let editName   = $state('')
  let editDesc   = $state('')
  let editCat    = $state('')
  let editOrder  = $state(0)

  // 새 코드 폼 상태
  let newCode    = $state('')
  let newName    = $state('')
  let newDesc    = $state('')
  let newCat     = $state('')
  let newOrder   = $state(99)


  // 검색
  let searchQuery = $state('')
  let matchedIds = $derived.by(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    const s = new Set<string>()
    for (const c of data.codes) {
      if (c.code.toLowerCase().includes(q) || c.name.includes(q)) s.add(c.id)
    }
    return s
  })

  function isVisible(node: TreeNode): boolean {
    if (!matchedIds) return true
    if (matchedIds.has(node.id)) return true
    return node.children.some(ch => isVisible(ch))
  }

  function toggleExpand(id: string) {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id); else next.add(id)
    expanded = next
  }

  function expandAll() { expanded = new Set(data.codes.map(c => c.id)) }
  function collapseAll() { expanded = new Set(data.codes.filter(c => c.depth === 0).map(c => c.id)) }

  function startEdit(node: TreeNode) {
    editingId = node.id
    editName  = node.name
    editDesc  = node.description ?? ''
    editCat   = node.product_category ?? ''
    editOrder = node.sort_order
    addingParentId = null
  }

  function cancelEdit() { editingId = null }

  function startAdd(parentId: string | null, parentCode?: string) {
    addingParentId = parentId
    newCode = parentCode ? parentCode + '-' : ''
    newName = ''; newDesc = ''; newCat = ''; newOrder = 99
    editingId = null
    if (parentId) expanded = new Set([...expanded, parentId])
    // 스크롤: 약간 delay 후 add-row로 이동
    setTimeout(() => document.getElementById('add-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }

  function cancelAdd() { addingParentId = null }

  // 상품 카테고리 정의
  const PRODUCT_CATS = [
    { value: 'camera',     label: '카메라' },
    { value: 'lens',       label: '렌즈' },
    { value: 'camcorder',  label: '캠코더' },
    { value: 'action_cam', label: '액션캠' },
    { value: 'drone',      label: '드론' },
    { value: 'lighting',   label: '조명' },
    { value: 'audio',      label: '오디오' },
    { value: 'accessory',  label: '악세서리' },
    { value: 'package',    label: '패키지' },
  ]

  // ── 예약코드 형식 상태 ─────────────────────────────────────────────
  let fmtPrefix  = $state(data.codeFormat.prefix       ?? 'CS')
  let fmtDate    = $state(data.codeFormat.date_format  ?? 'YYMM')
  let fmtSeq     = $state(String(data.codeFormat.seq_digits ?? 3))
  let fmtReset   = $state(data.codeFormat.reset_monthly !== false)
  let fmtSuffix  = $state(data.codeFormat.suffix       ?? '')
  let fmtDirty   = $state(false)

  function datePart(fmt: string): string {
    const now = new Date()
    const yy = String(now.getFullYear()).slice(2)
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    return fmt === 'YYYYMM' ? `${yyyy}${mm}` : `${yy}${mm}`
  }

  function buildPreview(catCode: string): string {
    const d   = datePart(fmtDate)
    const s   = '1'.padStart(Number(fmtSeq) || 3, '0')
    const sfx = fmtSuffix.trim() ? `-${fmtSuffix.trim().toUpperCase()}` : ''
    return `${fmtPrefix || 'CS'}-${catCode}-${d}-${s}${sfx}`
  }

  // ── 상품 매핑 상태 ─────────────────────────────────────────────────
  function getMappedCodeId(category: string): string {
    return data.mappings.find((m: TaxonomyMapping) => m.product_category === category)?.taxonomy_code_id ?? ''
  }

  // ── 폼 결과 처리 ───────────────────────────────────────────────────
  $effect(() => {
    if (!form) return
    const f = form as { action?: string; success?: boolean; error?: string }
    if (f.error) { csToast.error(f.error); return }
    if (!f.success) return
    const msgs: Record<string, string> = {
      addCode:     '분류코드가 추가되었습니다.',
      editCode:    '수정되었습니다.',
      deleteCode:  '삭제되었습니다.',
      toggleActive:'활성 상태가 변경되었습니다.',
      saveFormat:  '예약코드 형식이 저장되었습니다.',
      saveMapping: '매핑이 저장되었습니다.',
    }
    csToast.success(msgs[f.action ?? ''] ?? '저장되었습니다.')
    if (f.action === 'addCode')  cancelAdd()
    if (f.action === 'editCode') cancelEdit()
    if (f.action === 'saveFormat') fmtDirty = false
  })
</script>

<svelte:head><title>분류체계 코드 — CrazyShot CMS</title></svelte:head>

<div class="root">

  <!-- ══ 헤더 ═══════════════════════════════════════════════════════ -->
  <div class="page-header">
    <div>
      <h1 class="page-title">분류체계 & 코드 관리</h1>
      <p class="page-sub">영상촬영 장비 렌탈 업계 표준 분류체계 · 상품코드 · 예약코드 통합 관리</p>
    </div>

    <div class="stat-row">
      <div class="stat"><span class="sv">{stats.roots}</span><span class="sl">대분류</span></div>
      <div class="stat"><span class="sv">{stats.total}</span><span class="sl">전체 코드</span></div>
      <div class="stat green"><span class="sv">{stats.active}</span><span class="sl">활성</span></div>
      <div class="stat dim"><span class="sv">{stats.inactive}</span><span class="sl">비활성</span></div>
    </div>
  </div>

  <!-- ══ 탭 바 ═══════════════════════════════════════════════════════ -->
  <div class="tab-bar">
    <button class="tab-btn" class:tab-active={activeTab==='tree'} onclick={() => activeTab='tree'}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3h4v4H3zM10 3h11M10 7h8M3 10h4v4H3zM10 10h11M10 14h6M3 17h4v4H3zM10 17h11M10 21h5"/></svg>
      분류 체계
    </button>
    <button class="tab-btn" class:tab-active={activeTab==='format'} onclick={() => activeTab='format'}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 2v4M16 2v4M2 10h20"/></svg>
      예약코드 형식
      {#if fmtDirty}<span class="dirty-dot"></span>{/if}
    </button>
    <button class="tab-btn" class:tab-active={activeTab==='mapping'} onclick={() => activeTab='mapping'}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      상품 자동 매핑
    </button>
  </div>

  <!-- ══════════════════════════════════════════════════════════════════
       TAB 1: 분류 체계 트리
  ════════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'tree'}
  <div class="panel">

    <!-- 툴바 -->
    <div class="toolbar">
      <div class="search-wrap">
        <svg class="search-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input class="search-in" type="search" placeholder="코드 또는 코드명 검색…" bind:value={searchQuery} aria-label="검색" />
      </div>
      <div class="tb-actions">
        <button class="btn-ghost" onclick={expandAll}>전체 펼치기</button>
        <button class="btn-ghost" onclick={collapseAll}>접기</button>
        <button class="btn-primary" onclick={() => startAdd(null)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          대분류 추가
        </button>
      </div>
    </div>

    <!-- 트리 테이블 -->
    <div class="tree-wrap">
      <table class="tree-table" aria-label="분류체계 코드 트리">
        <thead>
          <tr>
            <th class="th-toggle"></th>
            <th class="th-code">코드</th>
            <th class="th-name">코드명 / 설명</th>
            <th class="th-cat">상품 카테고리</th>
            <th class="th-path">경로</th>
            <th class="th-prod">상품</th>
            <th class="th-depth">단계</th>
            <th class="th-active">활성</th>
            <th class="th-actions">작업</th>
          </tr>
        </thead>
        <tbody>
          <!-- 루트 추가 행 (대분류 추가) -->
          {#if addingParentId === null}
            {#snippet addRowSnippet(parentId: string | null, depth: number, parentCode: string)}
              <tr class="add-row" id="add-row">
                <td colspan="9">
                  <form method="POST" action="?/addCode" use:enhance class="add-form-inline">
                    <input type="hidden" name="parent_id" value={parentId ?? ''} />
                    <div class="af-row" style="padding-left: {depth * 32 + 8}px">
                      <div class="af-field">
                        <label class="af-lbl">코드 *</label>
                        <input
                          class="af-in code-in"
                          name="code"
                          type="text"
                          bind:value={newCode}
                          placeholder="{parentCode ? parentCode+'-' : ''}NEW"
                          maxlength="15"
                          autocomplete="off"
                          required
                        />
                      </div>
                      <div class="af-field af-wide">
                        <label class="af-lbl">코드명 *</label>
                        <input class="af-in" name="name" type="text" bind:value={newName} placeholder="장비 분류명" required />
                      </div>
                      <div class="af-field">
                        <label class="af-lbl">상품 카테고리</label>
                        <select class="af-in af-sel" name="product_category" bind:value={newCat}>
                          <option value="">연결 안 함</option>
                          {#each PRODUCT_CATS as c}
                            <option value={c.value}>{c.label}</option>
                          {/each}
                        </select>
                      </div>
                      <div class="af-field af-wide">
                        <label class="af-lbl">설명 (선택)</label>
                        <input class="af-in" name="description" type="text" bind:value={newDesc} placeholder="장비 유형 설명" />
                      </div>
                      <div class="af-field af-xs">
                        <label class="af-lbl">정렬</label>
                        <input class="af-in" name="sort_order" type="number" bind:value={newOrder} min="1" max="999" />
                      </div>
                      {#if newCode.trim()}
                        <div class="af-preview">
                          <span class="af-prev-lbl">생성 코드 예시</span>
                          <code class="af-prev-code">{buildPreview(newCode.trim().toUpperCase())}</code>
                        </div>
                      {/if}
                      <div class="af-btns">
                        <button type="submit" class="btn-submit">추가</button>
                        <button type="button" class="btn-cancel-sm" onclick={cancelAdd}>취소</button>
                      </div>
                    </div>
                  </form>
                </td>
              </tr>
            {/snippet}
            {@render addRowSnippet(null, 0, '')}
          {/if}

          <!-- 재귀 트리 렌더링 -->
          {#snippet renderTree(nodes: TreeNode[], depth: number)}
            {#each nodes as node (node.id)}
              {#if isVisible(node)}
                {@const color = nodeColor(node)}
                {@const isEditing = editingId === node.id}
                {@const prodCount = node.product_category ? (data.productCountMap[node.product_category] ?? 0) : null}
                {@const isMatch = matchedIds ? matchedIds.has(node.id) : false}

                <!-- 노드 행 -->
                <tr class="node-row"
                    class:node-inactive={!node.is_active}
                    class:node-match={isMatch}
                    class:node-editing={isEditing}>
                  <!-- 토글 -->
                  <td class="td-toggle">
                    <div style="display:flex;align-items:center;gap:2px;padding-left:{depth*28}px">
                      {#if node.children.length > 0}
                        <button
                          class="expand-btn"
                          class:expanded={expanded.has(node.id)}
                          onclick={() => toggleExpand(node.id)}
                          aria-label={expanded.has(node.id) ? '접기' : '펼치기'}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,18 15,12 9,6"/></svg>
                        </button>
                      {:else}
                        <span class="leaf-dot" style="background:{color}"></span>
                      {/if}
                      <span class="color-bar" style="background:{color}"></span>
                    </div>
                  </td>

                  <!-- 코드 배지 -->
                  <td class="td-code">
                    <span class="code-badge" style="--bc:{color}">{node.code}</span>
                  </td>

                  <!-- 코드명 / 편집 모드 -->
                  <td class="td-name">
                    {#if isEditing}
                      <form method="POST" action="?/editCode" use:enhance id="edit-form-{node.id}" class="if">
                        <input type="hidden" name="id" value={node.id} />
                        <div class="edit-fields">
                          <input class="edit-in" name="name" type="text" bind:value={editName} required placeholder="코드명" />
                          <input class="edit-in edit-desc-in" name="description" type="text" bind:value={editDesc} placeholder="설명 (선택)" />
                        </div>
                      </form>
                    {:else}
                      <div class="name-wrap">
                        <span class="name-main" class:dim-text={!node.is_active}>{node.name}</span>
                        {#if node.description}
                          <span class="name-desc">{node.description}</span>
                        {/if}
                        {#if node.children.length > 0}
                          <span class="child-count">{node.children.length}개 하위</span>
                        {/if}
                      </div>
                    {/if}
                  </td>

                  <!-- 카테고리 연결 -->
                  <td class="td-cat">
                    {#if isEditing}
                      <select class="edit-in" name="product_category" form="edit-form-{node.id}" bind:value={editCat}>
                        <option value="">연결 안 함</option>
                        {#each PRODUCT_CATS as c}
                          <option value={c.value}>{c.label}</option>
                        {/each}
                      </select>
                    {:else if node.product_category}
                      <span class="cat-pill" style="--bc:{color}">
                        {PRODUCT_CATS.find(c => c.value === node.product_category)?.label ?? node.product_category}
                      </span>
                    {:else}
                      <span class="no-data">—</span>
                    {/if}
                  </td>

                  <!-- 경로 -->
                  <td class="td-path">
                    <span class="path-text">{node.path_codes.join(' › ')}</span>
                  </td>

                  <!-- 상품 수 -->
                  <td class="td-prod">
                    {#if prodCount !== null && prodCount > 0}
                      <span class="prod-cnt">{prodCount}</span>
                    {:else}
                      <span class="no-data">—</span>
                    {/if}
                  </td>

                  <!-- 단계 -->
                  <td class="td-depth">
                    <span class="depth-badge">D{node.depth}</span>
                  </td>

                  <!-- 활성 토글 -->
                  <td class="td-active">
                    <form method="POST" action="?/toggleActive" use:enhance class="if">
                      <input type="hidden" name="id" value={node.id} />
                      <input type="hidden" name="is_active" value={String(node.is_active)} />
                      <button type="submit" class="toggle" class:toggle-on={node.is_active} aria-pressed={node.is_active}>
                        <span class="tog-track"><span class="tog-thumb"></span></span>
                      </button>
                    </form>
                  </td>

                  <!-- 작업 -->
                  <td class="td-actions">
                    {#if isEditing}
                      <div class="action-row">
                        <input type="hidden" name="sort_order" value={editOrder} form="edit-form-{node.id}" />
                        <button type="submit" class="act-save" form="edit-form-{node.id}">저장</button>
                        <button type="button" class="act-cancel" onclick={cancelEdit}>취소</button>
                      </div>
                    {:else}
                      <div class="action-row">
                        <button
                          class="act-btn act-add"
                          title="하위 코드 추가"
                          onclick={() => startAdd(node.id, node.code)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          하위
                        </button>
                        <button class="act-btn act-edit" title="편집" onclick={() => startEdit(node)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <form method="POST" action="?/deleteCode" use:enhance class="if">
                          <input type="hidden" name="id" value={node.id} />
                          <button
                            type="submit"
                            class="act-btn act-del"
                            title="삭제"
                            onclick={(e) => {
                              if (node.children.length > 0) {
                                e.preventDefault()
                                csToast.error(`하위 코드 ${node.children.length}개를 먼저 삭제해주세요.`)
                                return
                              }
                              if (!confirm(`'${node.code} (${node.name})' 코드를 삭제하시겠습니까?`)) e.preventDefault()
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
                          </button>
                        </form>
                      </div>
                    {/if}
                  </td>
                </tr>

                <!-- 하위 추가 행 -->
                {#if addingParentId === node.id}
                  <tr class="add-row" id="add-row">
                    <td colspan="9">
                      <form method="POST" action="?/addCode" use:enhance class="add-form-inline">
                        <input type="hidden" name="parent_id" value={node.id} />
                        <div class="af-row" style="padding-left:{(depth+1)*28+8}px">
                          <div class="af-field">
                            <label class="af-lbl">코드 *</label>
                            <input
                              class="af-in code-in"
                              name="code"
                              type="text"
                              bind:value={newCode}
                              placeholder="{node.code}-XXX"
                              maxlength="15"
                              autocomplete="off"
                              required
                            />
                          </div>
                          <div class="af-field af-wide">
                            <label class="af-lbl">코드명 *</label>
                            <input class="af-in" name="name" type="text" bind:value={newName} placeholder="장비 분류명" required />
                          </div>
                          <div class="af-field">
                            <label class="af-lbl">상품 카테고리</label>
                            <select class="af-in af-sel" name="product_category" bind:value={newCat}>
                              <option value="">연결 안 함</option>
                              {#each PRODUCT_CATS as c}
                                <option value={c.value}>{c.label}</option>
                              {/each}
                            </select>
                          </div>
                          <div class="af-field af-wide">
                            <label class="af-lbl">설명 (선택)</label>
                            <input class="af-in" name="description" type="text" bind:value={newDesc} placeholder="장비 유형 설명" />
                          </div>
                          <div class="af-field af-xs">
                            <label class="af-lbl">정렬</label>
                            <input class="af-in" name="sort_order" type="number" bind:value={newOrder} min="1" max="999" />
                          </div>
                          {#if newCode.trim()}
                            <div class="af-preview">
                              <span class="af-prev-lbl">예시 코드</span>
                              <code class="af-prev-code">{buildPreview(newCode.trim().toUpperCase())}</code>
                            </div>
                          {/if}
                          <div class="af-btns">
                            <button type="submit" class="btn-submit">추가</button>
                            <button type="button" class="btn-cancel-sm" onclick={cancelAdd}>취소</button>
                          </div>
                        </div>
                      </form>
                    </td>
                  </tr>
                {/if}

                <!-- 자식 재귀 렌더링 -->
                {#if expanded.has(node.id) || matchedIds}
                  {@render renderTree(node.children, depth + 1)}
                {/if}
              {/if}
            {/each}
          {/snippet}

          {@render renderTree(treeRoots, 0)}
        </tbody>
      </table>
    </div>

    <!-- 테이블 푸터 -->
    <div class="tree-footer">
      <span class="tf-info">
        대분류 {stats.roots}개 · 전체 {stats.total}개 노드 · 활성 {stats.active}개
      </span>
      <span class="tf-hint">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        코드는 수정 불가 (기존 자산 코드 무결성 보호) · 계층 무제한 추가 가능
      </span>
    </div>
  </div>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════
       TAB 2: 예약코드 형식
  ════════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'format'}
  <div class="panel">
    <form method="POST" action="?/saveFormat" use:enhance oninput={() => fmtDirty = true}>

      <!-- 토큰 시각화 -->
      <div class="fmt-section">
        <div class="fmt-section-title">코드 구조 시각화</div>
        <div class="token-row">
          <div class="token tk-prefix"><span class="tk-val">{fmtPrefix||'CS'}</span><span class="tk-role">접두어</span></div>
          <span class="tk-sep">—</span>
          <div class="token tk-cat"><span class="tk-val">CAM-ML</span><span class="tk-role">분류코드</span></div>
          <span class="tk-sep">—</span>
          <div class="token tk-date"><span class="tk-val">{datePart(fmtDate)}</span><span class="tk-role">{fmtDate}</span></div>
          <span class="tk-sep">—</span>
          <div class="token tk-seq"><span class="tk-val">{'1'.padStart(Number(fmtSeq)||3,'0')}</span><span class="tk-role">{fmtSeq}자리</span></div>
          {#if fmtSuffix.trim()}
          <span class="tk-sep">—</span>
          <div class="token tk-sfx"><span class="tk-val">{fmtSuffix.trim().toUpperCase()}</span><span class="tk-role">접미어</span></div>
          {/if}
        </div>
        <div class="full-preview-box">
          <span class="fp-label">실제 생성 예시</span>
          <span class="fp-code">{buildPreview('CAM-ML')}</span>
        </div>
      </div>

      <!-- 설정 그리드 -->
      <div class="fmt-grid">

        <div class="fmt-card">
          <div class="fc-title"><span class="fc-dot" style="background:var(--cs-dark)"></span>접두어</div>
          <input class="fc-in mono-in" name="prefix" type="text" bind:value={fmtPrefix} maxlength="6" placeholder="CS" autocomplete="off" />
          <p class="fc-hint">영문 대문자·숫자, 최대 6자. 브랜드 식별자.</p>
        </div>

        <div class="fmt-card">
          <div class="fc-title"><span class="fc-dot" style="background:var(--cs-info)"></span>날짜 형식</div>
          <div class="radio-stack">
            <label class="rl" class:rl-on={fmtDate==='YYMM'}>
              <input type="radio" name="date_format" value="YYMM" bind:group={fmtDate} />
              <div><div class="rl-val">YYMM</div><div class="rl-ex">{datePart('YYMM')} — 4자리 간결형</div></div>
            </label>
            <label class="rl" class:rl-on={fmtDate==='YYYYMM'}>
              <input type="radio" name="date_format" value="YYYYMM" bind:group={fmtDate} />
              <div><div class="rl-val">YYYYMM</div><div class="rl-ex">{datePart('YYYYMM')} — 6자리 명시형</div></div>
            </label>
          </div>
        </div>

        <div class="fmt-card">
          <div class="fc-title"><span class="fc-dot" style="background:var(--cs-success-light)"></span>일련번호 자릿수</div>
          <div class="seg-grid">
            {#each [['2','99'], ['3','999'], ['4','9,999'], ['5','99,999'], ['6','999,999']] as [d, cap]}
              <label class="seg" class:seg-on={fmtSeq===d}>
                <input type="radio" name="seq_digits" value={d} bind:group={fmtSeq} />
                <span class="seg-n">{d}자리</span>
                <span class="seg-c">max {cap}</span>
              </label>
            {/each}
          </div>
          <p class="fc-hint">월 최대 자산 등록 수 기준. 렌탈업 표준: 3자리.</p>
        </div>

        <div class="fmt-card">
          <div class="fc-title"><span class="fc-dot" style="background:var(--cs-success-light)"></span>순번 초기화</div>
          <div class="radio-stack">
            <label class="rl" class:rl-on={fmtReset}>
              <input type="radio" name="reset_monthly" value="true" checked={fmtReset} onchange={() => fmtReset=true} />
              <div><div class="rl-val">매월 초기화 <span class="recommend">권장</span></div><div class="rl-ex">월 전환 시 001부터 재시작</div></div>
            </label>
            <label class="rl" class:rl-on={!fmtReset}>
              <input type="radio" name="reset_monthly" value="false" checked={!fmtReset} onchange={() => fmtReset=false} />
              <div><div class="rl-val">누적 증가</div><div class="rl-ex">월과 무관하게 계속 증가</div></div>
            </label>
          </div>
        </div>

        <div class="fmt-card">
          <div class="fc-title"><span class="fc-dot" style="background:var(--cs-warning)"></span>접미어 (선택)</div>
          <input class="fc-in mono-in" name="suffix" type="text" bind:value={fmtSuffix} maxlength="4" placeholder="비워두면 미사용" autocomplete="off" />
          <p class="fc-hint">코드 끝에 추가 식별자. 예: KR, B2B, SER (최대 4자).</p>
        </div>

      </div>

      <!-- 카테고리별 미리보기 -->
      <div class="fmt-section">
        <div class="fmt-section-title">활성 분류코드별 생성 코드 미리보기</div>
        <div class="preview-grid">
          {#each data.codes.filter(c => c.is_active && c.depth === 1).slice(0, 18) as cc}
            {@const color = Object.values(ROOT_COLORS)[data.codes.findIndex(c => c.code === cc.path_codes[0]) % 12] ?? '#888'}
            <div class="pg-item">
              <span class="pg-badge" style="background:{color}">{cc.code}</span>
              <code class="pg-code">{buildPreview(cc.code)}</code>
            </div>
          {/each}
          {#if data.codes.filter(c => c.is_active && c.depth === 1).length > 18}
            <div class="pg-more">+{data.codes.filter(c => c.is_active && c.depth === 1).length - 18}개 더…</div>
          {/if}
        </div>
      </div>

      <!-- 저장 버튼 -->
      <div class="fmt-actions">
        {#if fmtDirty}
          <span class="unsaved">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            저장되지 않은 변경사항
          </span>
        {/if}
        <button type="submit" class="btn-save" class:btn-save-active={fmtDirty}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>
          형식 저장
        </button>
      </div>

    </form>
  </div>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════
       TAB 3: 상품 자동 매핑
  ════════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'mapping'}
  <div class="panel">
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
              <code class="mr-preview-code">{buildPreview(mappedNode.code)}</code>
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
  </div>
  {/if}

</div>

<style>
/* ── 레이아웃 ── */
.root {
  flex: 1;
  min-height: 0;                 /* flex item으로서 cms-main 안에서 수축 허용 */
  display: block;                /* 블록 컨텍스트 — 자식이 자연스럽게 쌓여 scrollHeight 증가 */
  padding: 18px 22px 24px;
  overflow-y: auto;
  box-sizing: border-box;
}

/* ── 헤더 ── */
.page-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; margin-bottom: 14px; flex-wrap: wrap;
}
.page-title { font: var(--text-pc-htitle-25); color: var(--cs-text); margin: 0 0 2px; }
.page-sub   { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }

.stat-row { display: flex; gap: 8px; flex-wrap: wrap; }
.stat {
  display: flex; flex-direction: column; align-items: center;
  padding: 8px 14px; background: var(--cs-white); border-radius: var(--radius-lg);
  min-width: 64px; gap: 1px;
}
.stat.green .sv { color: var(--cs-success-light); }
.stat.dim   .sv { color: var(--cs-text-light); }
.sv { font: var(--text-pc-title-18); color: var(--cs-text); line-height: 1; }
.sl { font: var(--text-pc-script-12); color: var(--cs-text-light); white-space: nowrap; }

/* ── 탭 ── */
.tab-bar {
  display: flex; gap: 2px; margin-bottom: 10px;
  background: var(--cs-white); border-radius: var(--radius-lg);
  padding: 4px; width: fit-content;
}
.tab-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 16px; border: none; border-radius: var(--radius-md);
  background: transparent; color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer;
  transition: background 0.12s, color 0.12s;
  min-height: 36px; position: relative; white-space: nowrap;
}
.tab-btn:hover { background: var(--cs-lilac); color: var(--cs-text); }
.tab-active    { background: var(--cs-purple) !important; color: var(--cs-white) !important; }
.dirty-dot {
  position: absolute; top: 6px; right: 7px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--cs-orange);
}

/* ── 패널 ── */
/* overflow: hidden — 패널은 고정 높이 없으므로 수직 클리핑 없음, border-radius 시각 클리핑만 적용 */
.panel { background: var(--cs-white); border-radius: var(--cms-radius-md); overflow: hidden; }

/* ── 툴바 ── */
.toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-bottom: 1px solid rgba(59,47,138,0.06);
}
.search-wrap { flex: 1; position: relative; max-width: 300px; }
.search-ico  { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--cs-text-light); pointer-events: none; }
.search-in   {
  width: 100%; box-sizing: border-box; height: 36px; padding: 0 10px 0 30px;
  border: none; border-radius: var(--cms-radius-sm);
  background: var(--cs-surface-gray); font: var(--text-pc-body-14); color: var(--cs-text);
}
.search-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
.search-in::placeholder { color: var(--cs-text-placeholder); }

.tb-actions { display: flex; gap: 6px; margin-left: auto; align-items: center; }
.btn-ghost {
  height: 34px; padding: 0 14px; border: none; border-radius: var(--radius-xl);
  background: var(--cs-lilac); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); font-weight: 700; cursor: pointer;
  transition: background 0.12s;
}
.btn-ghost:hover { background: rgba(59,47,138,0.12); }
.btn-primary {
  display: inline-flex; align-items: center; gap: 5px;
  height: 36px; padding: 0 16px; border: none; border-radius: var(--radius-xl);
  background: var(--cs-purple); color: var(--cs-white);
  font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s; white-space: nowrap;
}
.btn-primary:hover { background: var(--cs-purple-hover); }

/* ── 트리 테이블 ── */
.tree-wrap { overflow-x: auto; }
.tree-table { width: 100%; border-collapse: collapse; white-space: nowrap; }
.tree-table thead tr { background: var(--cs-surface-gray); }
.tree-table th {
  padding: 9px 12px; text-align: left;
  font: var(--text-pc-body-14); text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--cs-text-mid);
  border-bottom: 1px solid rgba(59,47,138,0.07);
}
.th-toggle  { width: 60px; }
.th-code    { width: 110px; }
.th-name    { min-width: 180px; white-space: normal; }
.th-cat     { width: 130px; }
.th-path    { min-width: 140px; }
.th-prod    { width: 56px; text-align: center; }
.th-depth   { width: 50px; text-align: center; }
.th-active  { width: 60px; text-align: center; }
.th-actions { width: 140px; }

.node-row td {
  padding: 10px 12px; vertical-align: middle;
  border-bottom: 1px solid rgba(59,47,138,0.04);
  transition: background 0.08s;
}
.node-row:hover td { background: rgba(236,235,244,0.3); }
.node-inactive { opacity: 0.45; }
.node-match td { background: rgba(255,69,0,0.05) !important; }
.node-editing td { background: rgba(59,47,138,0.04) !important; }
.node-row:last-child td { border-bottom: none; }

.td-toggle  { padding: 10px 6px 10px 10px !important; }
.td-prod    { text-align: center; }
.td-depth   { text-align: center; }
.td-active  { text-align: center; }

/* expand 버튼 */
.expand-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border: none; border-radius: 4px;
  background: transparent; color: var(--cs-text-light); cursor: pointer;
  transition: background 0.1s, transform 0.15s; flex-shrink: 0;
}
.expand-btn:hover { background: var(--cs-lilac); color: var(--cs-text); }
.expand-btn.expanded svg { transform: rotate(90deg); }
.expand-btn svg { transition: transform 0.15s; }

.leaf-dot {
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; flex-shrink: 0; margin-left: 7px;
}
.color-bar {
  display: inline-block; width: 3px; height: 24px;
  border-radius: 2px; flex-shrink: 0; margin-left: 4px;
}

/* 코드 배지 */
.code-badge {
  display: inline-block; padding: 3px 9px;
  background: var(--bc, var(--cs-dark)); color: var(--cs-white);
  border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); font-weight: 700;
  letter-spacing: 0.06em;
}

/* 이름 셀 */
.name-wrap { display: flex; flex-direction: column; gap: 1px; }
.name-main { font: var(--text-pc-body-14); color: var(--cs-text); }
.dim-text  { color: var(--cs-text-light); }
.name-desc { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
.child-count {
  display: inline-block; font: var(--text-pc-script-12); font-weight: 700;
  color: var(--cs-text-light); background: var(--cs-surface-gray);
  padding: 1px 6px; border-radius: var(--radius-sm); width: fit-content;
}

/* 카테고리 pill */
/* color-mix() 대신 ::before pseudo-element + currentColor opacity 사용 (Safari 15 이하 호환) */
.cat-pill {
  position: relative;
  display: inline-flex; align-items: center; padding: 3px 9px;
  color: var(--bc, var(--cs-purple));
  border-radius: var(--radius-full);
  font: var(--text-pc-script-12); font-weight: 700; white-space: nowrap;
}
.cat-pill::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;   /* inset 대신 명시적 4방향 (Safari 14 미만 대비) */
  border-radius: inherit;
  background: currentColor;
  opacity: 0.12;
  pointer-events: none;
}
.no-data { font: var(--text-pc-script-12); color: var(--cs-text-light); }

/* 경로 */
.path-text { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

/* 상품 수 */
.prod-cnt {
  display: inline-block; padding: 2px 8px; background: var(--cs-lilac);
  color: var(--cs-text-mid); border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); font-weight: 700;
}

/* 단계 */
.depth-badge {
  display: inline-block; padding: 2px 6px; background: var(--cs-surface-gray);
  color: var(--cs-text-light); border-radius: var(--radius-sm);
  font: var(--text-pc-descript-10); font-weight: 700; letter-spacing: 0.04em;
}

/* 토글 스위치 */
.if { display: inline; }
.toggle { border: none; background: none; cursor: pointer; padding: 2px; display: inline-flex; }
.tog-track {
  display: flex; align-items: center; width: 36px; height: 20px;
  border-radius: var(--cms-radius-sm); background: var(--cs-surface-gray); padding: 2px;
  transition: background 0.2s;
}
.toggle-on .tog-track { background: var(--cs-purple); }
.tog-thumb {
  width: 16px; height: 16px; border-radius: 50%; background: var(--cs-white);
  box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: transform 0.18s; pointer-events: none;
}
.toggle-on .tog-thumb { transform: translateX(16px); }

/* 작업 버튼 */
.action-row { display: flex; align-items: center; gap: 4px; }
.act-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 28px; border: none; border-radius: var(--radius-sm);
  background: transparent; cursor: pointer; transition: background 0.1s, color 0.1s;
  font: var(--text-pc-script-12); font-weight: 700;
}
.act-add  { gap: 3px; padding: 0 8px; color: var(--cs-purple); }
.act-add:hover  { background: rgba(59,47,138,0.08); }
.act-edit { padding: 0 8px; color: var(--cs-text-mid); }
.act-edit:hover { background: var(--cs-lilac); color: var(--cs-text); }
.act-del  { padding: 0 8px; color: var(--cs-text-light); }
.act-del:hover  { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
.act-save {
  height: 28px; padding: 0 12px; border: none; border-radius: var(--radius-xl);
  background: var(--cs-purple); color: var(--cs-white);
  font: var(--text-pc-script-12); font-weight: 700; cursor: pointer;
  transition: background 0.12s;
}
.act-save:hover   { background: var(--cs-purple-hover); }
.act-cancel {
  height: 28px; padding: 0 10px; border: none; border-radius: var(--radius-xl);
  background: var(--cs-surface-gray); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); font-weight: 700; cursor: pointer;
}

/* 편집 폼 인라인 */
.edit-fields { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.edit-in {
  height: 32px; padding: 0 10px;
  border: 1.5px solid rgba(59,47,138,0.15); border-radius: var(--radius-sm);
  background: var(--cs-white); font: var(--text-pc-body-14); color: var(--cs-text);
  -webkit-appearance: none; -moz-appearance: none; appearance: none;
}
.edit-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
.edit-desc-in { min-width: 180px; color: var(--cs-text-mid); }
/* select.edit-in 커스텀 화살표 */
select.edit-in {
  padding-right: 28px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpolyline points='6,9 12,15 18,9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  cursor: pointer;
}

/* 추가 행 */
.add-row td { padding: 0 !important; border-bottom: 2px solid rgba(59,47,138,0.10) !important; }
.add-form-inline { background: var(--cs-lilac); }
.af-row {
  display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap;
  padding: 14px 16px 14px;
}
.af-field { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 110px; }
.af-field.af-wide { min-width: 160px; flex: 2; }
.af-field.af-xs   { flex: 0 0 70px; min-width: 70px; }
.af-lbl { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-text-mid); text-transform: uppercase; letter-spacing: 0.06em; }
.af-in {
  height: 36px; padding: 0 10px;
  border: 1.5px solid rgba(59,47,138,0.12); border-radius: var(--cms-radius-sm);
  background: var(--cs-white); font: var(--text-pc-body-14); color: var(--cs-text);
}
.af-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
/* select 크로스브라우저: Safari native 화살표 제거 + 커스텀 chevron */
.af-sel {
  cursor: pointer;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpolyline points='6,9 12,15 18,9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 30px;
}
.code-in { font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; }

.af-preview {
  display: flex; flex-direction: column; gap: 2px; padding: 8px 12px;
  background: var(--cs-dark); border-radius: var(--cms-radius-sm); align-self: flex-end;
}
.af-prev-lbl  { font: var(--text-pc-descript-10); font-weight: 700; color: var(--cs-points); text-transform: uppercase; }
.af-prev-code { font: var(--text-pc-script-12); font-weight: 700; color: var(--cs-white); letter-spacing: 0.06em; }

.af-btns { display: flex; gap: 6px; align-items: center; align-self: flex-end; }
.btn-submit {
  height: 36px; padding: 0 16px; border: none; border-radius: var(--radius-xl);
  background: var(--cs-purple); color: var(--cs-white);
  font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s;
}
.btn-submit:hover { background: var(--cs-purple-hover); }
.btn-cancel-sm {
  height: 36px; padding: 0 12px; border: none; border-radius: var(--radius-xl);
  background: rgba(59,47,138,0.08); color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer;
}

/* 트리 푸터 */
.tree-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px; border-top: 1px solid rgba(59,47,138,0.06); gap: 12px; flex-wrap: wrap;
}
.tf-info { font: var(--text-pc-script-12); color: var(--cs-text-light); }
.tf-hint { display: flex; align-items: center; gap: 4px; font: var(--text-pc-script-12); color: var(--cs-text-light); }

/* ── 예약코드 형식 탭 ── */
.fmt-section { padding: 20px 22px; border-bottom: 1px solid rgba(59,47,138,0.06); }
.fmt-section-title { font: var(--text-pc-descript-10); font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: var(--cs-text-mid); margin-bottom: 12px; }

.token-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.token {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 18px; border-radius: var(--radius-lg); min-width: 68px;
}
.tk-prefix { background: var(--cs-dark); }
.tk-cat    { background: var(--cs-purple); }
.tk-date   { background: var(--cs-info); }
.tk-seq    { background: var(--cs-success-light); }
.tk-sfx    { background: var(--cs-warning); }
.tk-val  { font: var(--text-pc-title-16); font-weight: 700; color: var(--cs-white); letter-spacing: 0.05em; }
.tk-role { font: var(--text-pc-descript-10); color: rgba(255,255,255,0.55); white-space: nowrap; }
.tk-sep  { font: var(--text-pc-title-16); font-weight: 700; color: var(--cs-text-light); padding-bottom: 12px; margin: 0 -2px; }

.full-preview-box {
  display: flex; align-items: center; gap: 14px; padding: 10px 16px;
  background: var(--cs-lilac); border-radius: var(--radius-lg); width: fit-content;
}
.fp-label { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.fp-code  { font: var(--text-pc-title-18); font-weight: 700; color: var(--cs-text); letter-spacing: 0.07em; }

.fmt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1px; background: rgba(59,47,138,0.06); }
.fmt-card { background: var(--cs-white); padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
.fc-title { display: flex; align-items: center; gap: 7px; font: var(--text-pc-body-14); color: var(--cs-text); }
.fc-dot   { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.fc-in    {
  height: 40px; padding: 0 12px; border: 1.5px solid rgba(59,47,138,0.10);
  border-radius: var(--cms-radius-sm); background: var(--cs-surface-gray);
  font: var(--text-pc-body-14); color: var(--cs-text); width: 110px;
}
.fc-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
.mono-in { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.fc-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; line-height: 1.5; }

.radio-stack { display: flex; flex-direction: column; gap: 6px; }
.rl {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border: 1.5px solid rgba(59,47,138,0.08); border-radius: var(--cms-radius-sm); cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.rl-on { border-color: var(--cs-purple); background: rgba(59,47,138,0.04); }
.rl input[type="radio"] { accent-color: var(--cs-purple); flex-shrink: 0; }
.rl-val { font: var(--text-pc-body-14); color: var(--cs-text); }
.rl-ex  { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin-top: 1px; }
.recommend { display: inline-block; padding: 1px 5px; background: var(--cs-success-light); color: var(--cs-white); border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700; margin-left: 4px; }

.seg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.seg {
  display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 8px 6px;
  border: 1.5px solid rgba(59,47,138,0.08); border-radius: var(--cms-radius-sm); cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.seg-on { border-color: var(--cs-purple); background: rgba(59,47,138,0.04); }
.seg input[type="radio"] { display: none; }
.seg-n { font: var(--text-pc-body-14); color: var(--cs-text); }
.seg-c { font: var(--text-pc-script-12); color: var(--cs-text-mid); }

.preview-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.pg-item { display: flex; align-items: center; gap: 7px; }
.pg-badge {
  display: inline-block; padding: 2px 8px; color: var(--cs-white); border-radius: var(--radius-sm);
  font: var(--text-pc-script-12); font-weight: 700; white-space: nowrap;
}
.pg-code { font: var(--text-pc-script-12); color: var(--cs-text-dark); white-space: nowrap; }
.pg-more { font: var(--text-pc-script-12); color: var(--cs-text-light); align-self: center; }

.fmt-actions {
  display: flex; align-items: center; justify-content: flex-end; gap: 14px;
  padding: 14px 22px; border-top: 1px solid rgba(59,47,138,0.07);
}
.unsaved { display: flex; align-items: center; gap: 5px; font: var(--text-pc-script-12); color: var(--cs-orange); font-weight: 700; }
.btn-save {
  display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 22px;
  border: none; border-radius: var(--radius-xl);
  background: rgba(59,47,138,0.10); color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s, color 0.12s;
}
.btn-save-active { background: var(--cs-purple); color: var(--cs-white); }
.btn-save-active:hover { background: var(--cs-purple-hover); }

/* ── 매핑 탭 ── */
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
  border-radius: var(--cms-radius-sm); background: var(--cs-surface-gray);
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
</style>
