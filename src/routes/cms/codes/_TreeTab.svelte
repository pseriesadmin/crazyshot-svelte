<script lang="ts">
  import { enhance } from '$app/forms'
  import { csToast } from '$lib/utils/toast'
  import type { PageData, ActionData } from './$types'
  import type { TaxonomyCode } from './+page.server'
  import { ROOT_COLORS, buildPreview } from './_shared'

  interface Props { data: PageData; form: ActionData }
  let { data, form }: Props = $props()

  type TreeNode = TaxonomyCode & { children: TreeNode[] }

  function nodeColor(node: TreeNode): string {
    const root = node.path_codes[0] ?? node.code
    return ROOT_COLORS[root] ?? '#888'
  }

  // 트리 빌드
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

  // 트리 UI 상태
  let expanded = $state(new Set(data.codes.filter(c => c.depth === 0).map(c => c.id)))
  let editingId         = $state<string | null>(null)
  let showAddAccordion  = $state(false)
  let showPrefixModal   = $state(false)
  let newTier           = $state<'major'|'middle'|'minor'>('major')
  let newPrefix         = $state('')
  let prefixDraft       = $state('')
  let newUseYearMonth   = $state(true)
  let newSeqLimit       = $state<number|''>('')
  let newKwInput        = $state('')

  // 편집 폼 상태
  let editName         = $state('')
  let editDesc         = $state('')
  let editOrder        = $state(0)
  let editKeywords     = $state<string[]>([])
  let editKwInput      = $state('')
  let editUseYearMonth = $state(true)
  let editSeqLimit     = $state<number|''>('')

  // 새 코드 폼 상태
  let newCode     = $state('')
  let newName     = $state('')
  let newDesc     = $state('')
  let newKeywords = $state<string[]>([])

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

  function startEdit(node: TreeNode) {
    editingId        = node.id
    editName         = node.name
    editDesc         = node.description ?? ''
    editOrder        = node.sort_order
    editKeywords     = (node.meta_keywords as string[] | null) ?? []
    editKwInput      = ''
    editUseYearMonth = (node.code_rule as Record<string, unknown> | null)?.date_format !== 'NONE'
    editSeqLimit     = ((node.code_rule as Record<string, unknown> | null)?.seq_limit as number | undefined) ?? ''
  }
  function cancelEdit() { editingId = null }

  function clearPrefixSelection(pc: string) {
    if (prefixDraft === pc) prefixDraft = ''
    if (newPrefix === pc) newPrefix = ''
  }

  let prefixDraftNorm = $derived(prefixDraft.trim().toUpperCase())
  let canAddPrefix = $derived(
    prefixDraftNorm.length > 0 &&
    /^[A-Za-z0-9]{1,5}$/.test(prefixDraftNorm) &&
    !data.prefixCodes.includes(prefixDraftNorm)
  )
  let prefixCodesWithDraft = $derived(
    canAddPrefix ? [...data.prefixCodes, prefixDraftNorm] : data.prefixCodes
  )

  // 이관 모달 상태
  let showTransfer      = $state(false)
  let transferSrcId     = $state('')
  let transferSrcCode   = $state('')
  let transferSrcName   = $state('')
  let transferSrcProdCount = $state(0)
  let transferDstId     = $state('')

  function openTransfer(node: TreeNode) {
    const cat = node.product_category ?? node.code.toLowerCase()
    transferSrcId        = node.id
    transferSrcCode      = node.code
    transferSrcName      = node.name
    transferSrcProdCount = data.productCountMap[cat] ?? 0
    transferDstId        = ''
    showTransfer         = true
  }
  function closeTransfer() { showTransfer = false }

  let transferTargetOptions = $derived(
    data.codes.filter(c => c.depth === 0 && c.id !== transferSrcId && c.is_active && !c.deleted_at)
  )

  // 폼 결과 처리 (트리·이관 관련 액션)
  $effect(() => {
    if (!form) return
    const f = form as { action?: string; success?: boolean; error?: string; transferred?: number }
    if (f.error) { csToast.error(f.error); return }
    if (!f.success) return
    const msgs: Record<string, string> = {
      addCode:      '분류코드가 추가되었습니다.',
      editCode:     '수정되었습니다.',
      deleteCode:   '삭제되었습니다.',
      toggleActive: '활성 상태가 변경되었습니다.',
    }
    if (f.action === 'transferCode') {
      csToast.success(`이관 완료 — 상품 ${f.transferred ?? 0}개 품번 재발행됨. 물리 태그·라벨을 파기하세요.`)
      closeTransfer()
      return
    }
    if (msgs[f.action ?? '']) csToast.success(msgs[f.action ?? ''])
    if (f.action === 'savePrefixCodes') csToast.success('Prefix 목록이 저장되었습니다.')
    if (f.action === 'addCode')  showAddAccordion = false
    if (f.action === 'editCode') cancelEdit()
  })

  // stats (툴바 아래 노드 수)
</script>

<!-- 툴바 -->
<div class="toolbar">
  <div class="search-wrap">
    <svg class="search-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
    <input class="search-in" type="search" placeholder="코드 또는 코드명 검색…" bind:value={searchQuery} aria-label="검색" />
  </div>
  <div class="tb-actions">
    <button class="btn-primary" onclick={() => {
      newCode=''; newName=''; newDesc='';
      newKeywords=[]; newKwInput=''; newTier='major'; newPrefix='';
      newUseYearMonth=true; newSeqLimit='';
      showAddAccordion=!showAddAccordion;
    }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      코드 등록
    </button>
  </div>
</div>

<!-- 코드 등록 아코디언 -->
{#if showAddAccordion}
<div class="add-accordion">
  <form method="POST" action="?/addCode" use:enhance>
    <input type="hidden" name="parent_id" value="" />
    <input type="hidden" name="code_tier" value={newTier} />
    <input type="hidden" name="meta_keywords" value={newKeywords.join(',')} />
    <input type="hidden" name="date_include" value={newUseYearMonth ? 'true' : 'false'} />
    {#if newTier === 'major' && newPrefix}
      <input type="hidden" name="prefix_override" value={newPrefix} />
    {/if}

    <!-- 코드 유형 선택 -->
    <div class="ac-tier-row">
      <span class="ac-tier-lbl">코드 유형</span>
      <div class="ac-tier-btns">
        {#each ([['major','대분류'],['middle','중분류'],['minor','소분류']] as const) as [v,l]}
          <button type="button" class="ac-tier-btn" class:active={newTier===v} onclick={() => newTier = v}>{l}</button>
        {/each}
      </div>
    </div>

    <!-- 입력 필드 그리드 -->
    <div class="ac-grid">
      {#if newTier === 'major'}
      <div class="ac-field ac-prefix-field">
        <button type="button" class="ac-prefix-trigger"
          aria-label="발행사 Prefix"
          onclick={() => { prefixDraft = newPrefix; showPrefixModal = true }}>
          <span class="ac-prefix-label">발행사 · Prefix</span>
          <span class="ac-prefix-val">{newPrefix || data.codeFormat.prefix || 'CS'}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      {/if}
      <div class="ac-field ac-xs">
        <input class="ac-in" name="code" type="text" maxlength="5"
          placeholder="코드 · 영숫자@#%* 5자 (필수)"
          aria-label="코드 (필수)"
          bind:value={newCode}
          oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; (e.currentTarget as HTMLInputElement).value = v.replace(/[^A-Za-z0-9@#%*]/g,'').slice(0,5); newCode=(e.currentTarget as HTMLInputElement).value }}
          required />
      </div>
      <div class="ac-field ac-md">
        <input class="ac-in" name="name" type="text" maxlength="10"
          placeholder="코드명 · 최대 10자 (필수)"
          aria-label="코드명 (필수)"
          bind:value={newName} required />
      </div>
      <div class="ac-field ac-grow">
        <input class="ac-in" name="description" type="text" maxlength="20"
          placeholder="설명 · 최대 20자 (선택)"
          aria-label="설명"
          bind:value={newDesc} />
      </div>
    </div>

    <!-- 키워드 + 순번 상한 + 년월 토글 -->
    <div class="ac-opt-row">
      <div class="ac-kw-wrap">
        {#each newKeywords as kw, i}
          <span class="ac-kw-tag">
            {kw}
            <button type="button" class="ac-kw-del" onclick={() => newKeywords = newKeywords.filter((_,j)=>j!==i)}>×</button>
          </span>
        {/each}
        {#if newKeywords.length < 10}
          <input class="ac-kw-in" type="text" maxlength="5"
            placeholder="키워드 · 입력 후 Enter (최대 10개, 5자)"
            aria-label="키워드"
            bind:value={newKwInput}
            onkeydown={(e) => {
              if (e.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                const v = newKwInput.replace(/[^A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ@#%*]/g,'').trim()
                if (v && newKeywords.length < 10) { newKeywords = [...newKeywords, v]; newKwInput = '' }
              }
            }} />
        {/if}
      </div>
      <div class="ac-opt-field">
        <input class="ac-in ac-seq" name="seq_limit" type="number"
          placeholder="순번 상한 · 최대 999"
          aria-label="순번 상한"
          bind:value={newSeqLimit} min="1" max="999" />
      </div>
      <label class="ac-toggle-wrap">
        <span class="ac-toggle-lbl">년월 포함</span>
        <button type="button" class="ac-toggle" class:on={newUseYearMonth}
          onclick={() => newUseYearMonth = !newUseYearMonth}
          role="switch" aria-checked={newUseYearMonth}>
          <span class="ac-toggle-thumb"></span>
        </button>
        <span class="ac-toggle-hint">{newUseYearMonth ? `예: ${new Date().getFullYear().toString().slice(2)}${String(new Date().getMonth()+1).padStart(2,'0')}` : '미사용'}</span>
      </label>
    </div>

    <!-- 미리보기 -->
    {#if newCode.trim()}
    <div class="ac-preview">
      <span class="ac-prev-lbl">생성 코드 예시</span>
      <code class="ac-prev-code">{buildPreview(newCode.trim().toUpperCase(), { ...(newUseYearMonth ? data.codeFormat : { ...data.codeFormat, date_format: 'NONE' as 'YYMM' }), ...(newTier === 'major' && newPrefix ? { prefix: newPrefix } : {}) })}</code>
    </div>
    {/if}

    <!-- 액션 -->
    <div class="ac-actions">
      <button type="button" class="btn-secondary" onclick={() => showAddAccordion = false}>취소</button>
      <button type="submit" class="btn-primary" disabled={!newCode.trim() || !newName.trim()}>등록</button>
    </div>
  </form>
</div>
{/if}

<!-- 코드 카드 목록 -->
<div class="code-card-list" role="list" aria-label="분류체계 코드 목록">

  {#snippet renderTree(nodes: TreeNode[], depth: number)}
    {#each nodes as node (node.id)}
      {#if isVisible(node)}
        {@const color = nodeColor(node)}
        {@const isEditing = editingId === node.id}
        {@const isMatch = matchedIds ? matchedIds.has(node.id) : false}

        <div class="code-card"
             class:card-inactive={!node.is_active}
             class:card-match={isMatch}
             class:card-editing={isEditing}
             role="listitem">

          <!-- 계층 인덴트 + 컬러 바 -->
          <div class="card-left" style="padding-left:{depth * 20}px">
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

          <!-- 코드 배지 -->
          <span class="code-badge" style="--bc:{color}">{node.code}</span>

          <!-- 메인 콘텐츠 -->
          {#if isEditing}
            {@const editTier = node.depth === 0 ? 'major' : node.depth === 1 ? 'middle' : 'minor'}
            {@const editRule = node.code_rule as Record<string,unknown> | null}
            {@const editPreviewFmt = {
              ...data.codeFormat,
              ...(editRule?.prefix ? { prefix: editRule.prefix as string } : {}),
              ...(editUseYearMonth ? {} : { date_format: 'NONE' as 'YYMM' }),
              ...(editSeqLimit ? { seq_digits: String(editSeqLimit).length } : {}),
            }}
            <form method="POST" action="?/editCode" use:enhance id="edit-form-{node.id}" class="edit-block">
              <input type="hidden" name="id" value={node.id} />
              <input type="hidden" name="sort_order" value={editOrder} />
              <!-- Row 1: 유형 배지(읽기전용) | 코드명 | 설명 | 키워드 -->
              <div class="edit-row1">
                <span class="tier-badge-ro tier-ro-{editTier}" title="유형은 생성 후 변경 불가">
                  {editTier === 'major' ? '대분류' : editTier === 'middle' ? '중분류' : '소분류'}
                </span>
                <input class="edit-in edit-name-in" name="name" type="text" value={editName} required placeholder="코드명" />
                <input class="edit-in edit-desc-in2" name="description" type="text" value={editDesc} placeholder="설명 (선택)" />
                <!-- 키워드 태그 영역 -->
                <div class="edit-kw-wrap">
                  {#each editKeywords as kw, i}
                    <span class="edit-kw-chip">
                      {kw}
                      <button type="button" class="edit-kw-del" onclick={() => editKeywords = editKeywords.filter((_,j) => j !== i)}>×</button>
                    </span>
                  {/each}
                  <input
                    class="edit-kw-in"
                    type="text"
                    placeholder="키워드 입력 후 Enter"
                    value={editKwInput}
                    oninput={(e) => editKwInput = (e.currentTarget as HTMLInputElement).value}
                    onkeydown={(e) => {
                      if (e.isComposing) return
                      if ((e.key === 'Enter' || e.key === ',') && editKwInput.trim()) {
                        e.preventDefault()
                        const kw = editKwInput.trim()
                        if (!editKeywords.includes(kw)) editKeywords = [...editKeywords, kw]
                        editKwInput = ''
                      }
                    }}
                  />
                  <input type="hidden" name="meta_keywords" value={editKeywords.join(',')} />
                </div>
              </div>
              <!-- Row 2: 년월 토글 | 순번제한 -->
              <div class="edit-row2">
                <label class="edit-toggle-wrap">
                  <button type="button"
                    class="edit-toggle"
                    class:on={editUseYearMonth}
                    onclick={() => editUseYearMonth = !editUseYearMonth}
                    role="switch"
                    aria-checked={editUseYearMonth}
                  >
                    <span class="edit-toggle-thumb"></span>
                  </button>
                  <span class="edit-toggle-lbl">년월 포함</span>
                  <input type="hidden" name="date_include" value={editUseYearMonth ? 'true' : 'false'} />
                </label>
                <label class="edit-seq-field">
                  <span class="edit-seq-lbl">순번 제한</span>
                  <input
                    class="edit-in edit-seq-in"
                    name="seq_limit"
                    type="number"
                    min="1"
                    max="9999"
                    placeholder="무제한"
                    value={editSeqLimit}
                    oninput={(e) => {
                      const v = (e.currentTarget as HTMLInputElement).value
                      editSeqLimit = v ? Number(v) : ''
                    }}
                  />
                </label>
              </div>
            </form>
            <!-- 라이브 미리보기 (form 외부 — 제출 데이터 오염 방지) -->
            <div class="edit-preview-row">
              <span class="edit-prev-lbl">코드 예시</span>
              <code class="edit-prev-code">{buildPreview(node.code, editPreviewFmt)}</code>
            </div>
          {:else}
            {@const viewKws = ((node.meta_keywords as string[] | null) ?? []).map(k => String(k).replace(/^"+|"+$/g, '').trim()).filter(Boolean)}
            {@const viewTier = node.code_tier ?? (node.depth === 0 ? 'major' : node.depth === 1 ? 'middle' : 'minor')}
            {@const viewSeqLimit = (node.code_rule as Record<string,unknown> | null)?.seq_limit as number | undefined}
            {@const viewRule = node.code_rule as Record<string,unknown> | null}
            {@const previewFmt = {
              ...data.codeFormat,
              ...(viewRule?.prefix ? { prefix: viewRule.prefix as string } : {}),
              ...(viewRule?.date_format === 'NONE' ? { date_format: 'NONE' as 'YYMM' } : {}),
              ...(viewSeqLimit ? { seq_digits: String(viewSeqLimit).length } : {}),
            }}
            <div class="card-info">
              <span class="tier-badge tier-{viewTier}">
                {viewTier === 'major' ? '대분류' : viewTier === 'middle' ? '중분류' : '소분류'}
              </span>
              <span class="name-main" class:dim-text={!node.is_active}>{node.name}</span>
              {#if node.description}
                <span class="name-desc">{node.description}</span>
              {/if}
              {#if viewKws.length > 0 || node.children.length > 0}
                <div class="name-chips">
                  {#each viewKws as kw}
                    <span class="view-kw-tag">{kw}</span>
                  {/each}
                  {#if node.children.length > 0}
                    <span class="child-count">{node.children.length}개 하위</span>
                  {/if}
                </div>
              {/if}
              {#if viewSeqLimit}
                <span class="seq-limit-chip">max {viewSeqLimit}</span>
              {/if}
            </div>
            <div class="card-right-info">
              <code class="node-code-preview">{buildPreview(node.code, previewFmt)}</code>
            </div>
          {/if}

          <!-- 활성 토글 -->
          <div class="card-toggle">
            <form method="POST" action="?/toggleActive" use:enhance class="if">
              <input type="hidden" name="id" value={node.id} />
              <input type="hidden" name="is_active" value={String(node.is_active)} />
              <button type="submit" class="toggle" class:toggle-on={node.is_active} aria-pressed={node.is_active}>
                <span class="tog-track"><span class="tog-thumb"></span></span>
              </button>
            </form>
          </div>

          <!-- 작업 버튼 -->
          <div class="card-actions">
            {#if isEditing}
              <button type="submit" class="act-save" form="edit-form-{node.id}">저장</button>
              <button type="button" class="act-cancel" onclick={cancelEdit}>취소</button>
            {:else}
              {#if data.userRole === 'superadmin' && node.depth === 0}
                <button class="act-btn act-transfer" title="상품 이관" onclick={() => openTransfer(node)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                  이관
                </button>
              {/if}
              <button class="act-btn act-edit" onclick={() => startEdit(node)}>수정</button>
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
            {/if}
          </div>
        </div>

        <!-- 자식 재귀 렌더링 -->
        {#if expanded.has(node.id) || matchedIds}
          {@render renderTree(node.children, depth + 1)}
        {/if}
      {/if}
    {/each}
  {/snippet}

  {@render renderTree(treeRoots, 0)}
</div>

<!-- ══ Prefix 설정 모달 ══ -->
{#if showPrefixModal}
  <div class="modal-backdrop" role="presentation" onclick={() => showPrefixModal = false}>
    <div class="prefix-modal" role="dialog" aria-modal="true" aria-label="Prefix 설정"
         onclick={(e) => e.stopPropagation()}>

      <div class="pm-header">
        <button class="pm-close" onclick={() => showPrefixModal = false} aria-label="닫기">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="pm-body">
        <div class="pm-section">
          <p class="pm-hint">등록된 Prefix 코드</p>
          <div class="pm-chips">
            {#each data.prefixCodes as pc}
              <div class="pm-prefix-chip" class:active={prefixDraft === pc}>
                <button
                  type="button"
                  class="ac-prefix-btn"
                  onclick={() => { prefixDraft = prefixDraft === pc ? '' : pc }}
                >{pc}</button>
                <form
                  method="POST"
                  action="?/savePrefixCodes"
                  use:enhance
                  onsubmit={() => clearPrefixSelection(pc)}
                >
                  <input type="hidden" name="prefix_codes" value={JSON.stringify(data.prefixCodes.filter((c) => c !== pc))} />
                  <button
                    type="submit"
                    class="pm-prefix-del"
                    aria-label="{pc} Prefix 삭제"
                    title="삭제"
                    disabled={data.prefixCodes.length <= 1}
                  >×</button>
                </form>
              </div>
            {/each}
          </div>
        </div>

        <div class="pm-section">
          <p class="pm-hint">직접 입력</p>
          <div class="pm-input-row">
            <input class="fc-in mono-in pm-in" type="text" maxlength="5"
              placeholder="5자 이내 영문, 숫자 조합"
              value={prefixDraft}
              oninput={(e) => { prefixDraft = (e.currentTarget as HTMLInputElement).value.toUpperCase().replace(/[^A-Za-z0-9]/g,'').slice(0,5) }} />
            <form method="POST" action="?/savePrefixCodes" use:enhance class="pm-add-form">
              <input type="hidden" name="prefix_codes" value={JSON.stringify(prefixCodesWithDraft)} />
              <button
                type="submit"
                class="pm-add-btn"
                aria-label="Prefix 추가"
                title="목록에 추가"
                disabled={!canAddPrefix}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </form>
          </div>
        </div>
      </div>

      <div class="pm-actions">
        <button type="button" class="btn-secondary" onclick={() => showPrefixModal = false}>취소</button>
        <button type="button" class="btn-primary" onclick={() => { newPrefix = prefixDraft; showPrefixModal = false }}>적용</button>
      </div>

    </div>
  </div>
{/if}

<!-- ══ 이관 모달 (superadmin 전용) ══ -->
{#if showTransfer}
  <div class="transfer-backdrop" role="presentation" onclick={closeTransfer}>
    <div class="transfer-dialog" role="dialog" aria-modal="true" aria-label="상품 이관"
         onclick={(e) => e.stopPropagation()}>

      <div class="td-header">
        <h2 class="td-title">상품 이관</h2>
        <button class="td-close-btn" onclick={closeTransfer} aria-label="닫기">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="td-warn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cs-warning)" stroke-width="2" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <p class="td-warn-txt">
          이관 후 <strong>물리 태그·라벨에 인쇄된 기존 품번을 파기</strong>해야 합니다.<br>
          프로모션·쿠폰에 연동된 기존 품번은 사용 불가 처리됩니다.<br>
          이관된 상품 품번은 타겟 코드 규칙으로 <strong>새로 발행</strong>됩니다.
        </p>
      </div>

      <div class="td-src">
        <span class="td-src-label">이관 소스</span>
        <span class="td-src-code">{transferSrcCode} ({transferSrcName})</span>
        <span class="td-src-count">— 상품 {transferSrcProdCount}개</span>
      </div>

      <div class="td-field">
        <label for="transfer-target">이관 대상 코드 선택 *</label>
        <select id="transfer-target" class="td-select" bind:value={transferDstId}>
          <option value="">— 대상 코드를 선택하세요 —</option>
          {#each transferTargetOptions as t}
            <option value={t.id}>{t.code} ({t.name})</option>
          {/each}
        </select>
      </div>

      <div class="td-actions">
        <button class="td-btn-cancel" onclick={closeTransfer}>취소</button>
        <form method="POST" action="?/transferCode" use:enhance>
          <input type="hidden" name="source_id" value={transferSrcId} />
          <input type="hidden" name="target_id"  value={transferDstId} />
          <button
            type="submit"
            class="td-btn-confirm"
            disabled={!transferDstId}
            onclick={(e) => {
              if (!confirm(`'${transferSrcCode}' 코드에 연결된 상품 ${transferSrcProdCount}개를 이관합니다.\n기존 품번이 모두 새로 발행되며 물리 태그를 파기해야 합니다.\n\n계속하시겠습니까?`)) {
                e.preventDefault()
              }
            }}
          >이관 실행</button>
        </form>
      </div>
    </div>
  </div>
{/if}

<style>
/* 툴바 */
.toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
}
.search-wrap { flex: 1; position: relative; max-width: 300px; }
.search-ico  { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--cs-text-light); pointer-events: none; }
.search-in   {
  width: 100%; box-sizing: border-box; height: 36px; padding: 0 10px 0 30px;
  border: 1px solid #ECEBF4; border-radius: var(--radius-sm);
  background: var(--cs-white); font: var(--text-pc-body-14); color: var(--cs-text-mid);
}
.search-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
.search-in::placeholder { color: var(--cs-text-placeholder); }
.tb-actions { display: flex; gap: 6px; margin-left: auto; align-items: center; }

/* 버튼 — CMS standardButtons (ctaPrimary / ctaSecondary) */
.btn-primary {
  display: inline-flex; align-items: center; gap: 5px;
  height: 44px; padding: 0 30px; border: none; border-radius: var(--radius-md);
  background: var(--cs-purple); color: var(--cs-white);
  font: var(--text-pc-body-14); letter-spacing: -0.5px;
  cursor: pointer; transition: background 0.12s; white-space: nowrap;
  text-decoration: none; box-shadow: none;
}
.btn-primary:hover { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
.btn-secondary {
  display: inline-flex; align-items: center; gap: 5px;
  height: 44px; padding: 0 30px; border-radius: var(--radius-md);
  background: var(--cs-white); color: var(--cs-purple-dark);
  border: 1px solid #201857;
  font: var(--text-pc-body-14); letter-spacing: -0.5px;
  cursor: pointer; transition: background 0.12s, color 0.12s; white-space: nowrap;
  text-decoration: none; box-shadow: none;
}
.btn-secondary:hover { background: rgba(59,47,138,0.06); }

/* 코드 등록 아코디언 */
.add-accordion {
  background: var(--cs-white);
  border-radius: var(--cms-radius-md);
  border: 1px solid #ECEBF4;
  padding: 20px;
  margin-top: 10px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.add-accordion form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ac-tier-row { display: flex; align-items: center; gap: 12px; }
.ac-tier-lbl { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; min-width: 52px; }
.ac-tier-btns { display: flex; gap: 6px; }
.ac-tier-btn {
  height: 30px; padding: 0 14px; border-radius: var(--radius-sm);
  border: 1px solid #ECEBF4; background: var(--cs-white); color: var(--cs-text);
  font: var(--text-pc-script-12); cursor: pointer; transition: background 0.12s, color 0.12s;
}
.ac-tier-btn.active { background: var(--cs-purple-dark); color: var(--cs-white); border-color: var(--cs-purple-dark); }

.ac-grid { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.ac-field { display: flex; flex-direction: column; }
.ac-xs  { width: 120px; }
.ac-md  { width: 160px; }
.ac-grow { flex: 1; min-width: 140px; }
.ac-in {
  height: 44px; padding: 10px 16px; background: var(--cs-surface-gray);
  border: none; border-radius: var(--radius-sm);
  font: var(--text-pc-body-14); color: var(--cs-text); width: 100%; box-sizing: border-box;
}
.ac-in::placeholder { color: var(--cs-text-light); font-size: 12px; }
.ac-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: var(--cs-purple); }

.ac-kw-wrap {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  width: 400px; flex: 0 0 400px;
  min-height: 44px; padding: 8px 12px;
  background: var(--cs-surface-gray); border-radius: var(--radius-sm);
  border: none; box-sizing: border-box;
}
.ac-kw-wrap:focus-within {
  outline: 2px solid var(--cs-purple);
  outline-offset: -2px;
}
.ac-kw-tag {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  background: var(--cs-purple-op10); color: var(--cs-purple);
  border-radius: 4px; font: var(--text-pc-script-12); font-size: 12px;
}
.ac-kw-del { background: none; border: none; cursor: pointer; color: var(--cs-purple); font-size: 14px; line-height: 1; padding: 0; }
.ac-kw-in {
  flex: 1; min-width: 80px; border: none; background: transparent;
  font: var(--text-pc-script-12); font-size: 12px; color: var(--cs-text); padding: 0 4px;
  outline: none; box-shadow: none;
}
.ac-kw-in:focus,
.ac-kw-in:focus-visible {
  outline: none;
  border: none;
  box-shadow: none;
}
.ac-kw-in::placeholder { color: var(--cs-text-light); }

.ac-opt-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-opt-field { width: 160px; flex-shrink: 0; }
.ac-seq { width: 100%; }
.ac-toggle-wrap { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.ac-toggle-lbl { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.ac-toggle {
  position: relative; width: 36px; height: 20px; border: none;
  border-radius: 10px; background: var(--cs-disabled-toggle); cursor: pointer; padding: 2px;
  transition: background 0.2s;
}
.ac-toggle.on { background: var(--cs-purple); }
.ac-toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: var(--cs-white); transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.ac-toggle.on .ac-toggle-thumb { transform: translateX(16px); }
.ac-toggle-hint { font: var(--text-pc-script-12); color: var(--cs-text-light); min-width: 60px; }

.ac-prefix-field { flex-shrink: 0; }
.ac-prefix-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  height: 44px; padding: 0 16px; background: var(--cs-dark); color: var(--cs-white);
  border: none; border-radius: var(--radius-sm); font: var(--text-pc-script-12);
  cursor: pointer; white-space: nowrap; transition: opacity 0.12s;
}
.ac-prefix-trigger:hover { opacity: 0.85; }
.ac-prefix-label { color: rgba(255,255,255,0.6); font-size: 11px; }
.ac-prefix-val { font-family: 'Courier New', monospace; font-weight: 700; font-size: 13px; }

.ac-preview {
  display: flex; align-items: center; gap: 10px; padding: 8px 14px;
  background: rgba(59,47,138,0.04); border-radius: var(--radius-sm);
}
.ac-prev-lbl { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
.ac-prev-code {
  font-family: 'Courier New', monospace; font-size: 13px; font-weight: 700;
  color: var(--cs-purple); background: var(--cs-purple-op10); padding: 2px 8px; border-radius: 4px;
}
.ac-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* 코드 카드 목록 */
.code-card-list { display: flex; flex-direction: column; gap: 20px; padding: 12px; }
.code-card {
  display: flex; align-items: center; gap: 10px; background: var(--cs-white);
  border-radius: var(--cms-radius-md); border: 1px solid #ECEBF4;
  box-shadow: 0px 1px 4px rgba(0,0,0,0.06); overflow: hidden;
  transition: background 0.12s; flex-shrink: 0;
  padding: 20px; box-sizing: border-box;
}
.code-card:hover     { background: var(--cs-purple-op10); }
.code-card.card-editing  { background: var(--cs-surface-gray); }
.code-card.card-match    { background: rgba(255,69,0,0.05); }
.code-card.card-inactive { opacity: 0.48; }

.card-left { display: flex; align-items: center; gap: 4px; padding: 0; flex-shrink: 0; }

/* 일반 모드 카드 정보 — 그룹1: 유형+코드명 / 그룹2: 설명+키워드+순번상한 */
.card-info {
  flex: 1; min-width: 0; padding: 0;
  display: flex; flex-direction: row; align-items: center; gap: 8px;
}
.card-info > .tier-badge { margin-right: 12px; }
.card-info > .name-desc { margin-right: 12px; }
.card-info > .name-chips { margin-right: 12px; }
.name-chips { display: flex; flex-wrap: nowrap; gap: 8px; flex-shrink: 0; }

/* 우측: 생성 코드 예시 */
.card-right-info {
  display: flex; align-items: center; gap: 8px; padding: 0; flex-shrink: 0;
  margin-left: 12px;
}
/* 일반 모드 tier badge */
.tier-badge { display: inline-block; padding: 3px 10px; border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700; white-space: nowrap; }
.tier-major  { background: var(--cs-dark);       color: var(--cs-white); }
.tier-middle { background: var(--cs-purple);      color: var(--cs-white); }
.tier-minor  { background: var(--cs-purple-op10); color: var(--cs-purple); }
/* 수정 모드 tier badge (읽기전용) */
.tier-badge-ro {
  display: inline-block; padding: 3px 10px; border-radius: var(--radius-xl);
  font: var(--text-pc-script-12); font-weight: 700; white-space: nowrap;
  pointer-events: none; user-select: none; flex-shrink: 0;
  opacity: 0.75;
}
.tier-ro-major  { background: var(--cs-dark);       color: var(--cs-white); }
.tier-ro-middle { background: var(--cs-purple);      color: var(--cs-white); }
.tier-ro-minor  { background: var(--cs-purple-op10); color: var(--cs-purple); }
/* seq_limit 칩 */
.seq-limit-chip {
  display: inline-block; padding: 2px 8px;
  background: var(--cs-surface-gray); color: var(--cs-text-mid);
  border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700;
  white-space: nowrap;
}

.card-toggle { padding: 0; flex-shrink: 0; }
.card-actions { display: flex; align-items: center; gap: 4px; padding: 0; flex-shrink: 0; }

.code-badge {
  display: inline-block; padding: 3px 9px;
  background: var(--bc, var(--cs-dark)); color: var(--cs-white);
  border-radius: var(--radius-sm); font: var(--text-pc-script-12); font-weight: 700; letter-spacing: 0.06em;
}
.name-main {
  font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text);
  white-space: nowrap; flex-shrink: 0;
  margin-right: 20px;
}
.dim-text  { color: var(--cs-text-light); }
.name-desc {
  font: var(--text-pc-script-12); color: var(--cs-text-mid);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex-shrink: 1; min-width: 0; max-width: 280px;
}
.child-count {
  display: inline-block; font: var(--text-pc-script-12); font-weight: 700;
  color: var(--cs-text-light); background: var(--cs-surface-gray);
  padding: 1px 6px; border-radius: var(--radius-sm); width: fit-content;
}
.view-kw-tag {
  display: inline-block; padding: 1px 7px;
  background: rgba(59,47,138,0.08); color: var(--cs-purple);
  border-radius: 5px; font: var(--text-pc-script-12); white-space: nowrap;
}

.node-code-preview {
  font: var(--text-pc-script-12); font-weight: 700; letter-spacing: 0.07em;
  color: var(--cs-text-dark); background: var(--cs-surface-gray);
  padding: 2px 8px; border-radius: var(--radius-sm); white-space: nowrap; font-family: monospace;
}

/* expand/leaf */
.expand-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border: none; border-radius: 4px;
  background: transparent; color: var(--cs-text-light); cursor: pointer;
  transition: background 0.1s, transform 0.15s; flex-shrink: 0;
}
.expand-btn:hover { background: var(--cs-lilac); color: var(--cs-text); }
.expand-btn.expanded svg { transform: rotate(90deg); }
.expand-btn svg { transition: transform 0.15s; }
.leaf-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-left: 7px; }
.color-bar { display: inline-block; width: 3px; height: 24px; border-radius: 2px; flex-shrink: 0; margin-left: 4px; }

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
.act-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 28px; border: none; border-radius: var(--radius-sm);
  background: transparent; cursor: pointer; transition: background 0.1s, color 0.1s;
  font: var(--text-pc-script-12); font-weight: 700;
}
.act-edit { padding: 0 8px; color: var(--cs-text-mid); }
.act-edit:hover { background: var(--cs-lilac); color: var(--cs-text); }
.act-del  { padding: 0 8px; color: var(--cs-text-light); }
.act-del:hover  { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
.act-transfer {
  display: flex; align-items: center; gap: 4px; padding: 4px 8px; height: 28px;
  border: none; border-radius: var(--radius-sm);
  background: #FFEAEA; color: var(--cs-red-badge);
  font: var(--text-pc-script-12); font-weight: 700; cursor: pointer; transition: background 0.12s; white-space: nowrap;
  outline: none;
}
.act-transfer:hover { background: rgba(255,53,53,0.12); }
.act-transfer:focus,
.act-transfer:focus-visible { outline: none; }
.act-save {
  height: 34px; padding: 0 12px; border: none; border-radius: var(--cms-radius-sm);
  background: var(--cs-purple); color: var(--cs-white);
  font: var(--text-pc-script-12); font-weight: 700; cursor: pointer; transition: background 0.12s;
}
.act-save:hover { background: var(--cs-purple-hover); }
.act-cancel {
  height: 34px; padding: 0 10px; border: none; border-radius: var(--cms-radius-sm);
  background: var(--cs-surface-gray); color: var(--cs-text-mid);
  font: var(--text-pc-script-12); font-weight: 700; cursor: pointer;
}

/* 편집 폼 블록 (2행) */
.edit-block {
  flex: 1; min-width: 0; padding: 0;
  display: flex; flex-direction: column; gap: 6px;
}
.edit-row1 { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
.edit-row2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.edit-in {
  height: 44px; padding: 10px 16px; box-sizing: border-box;
  border: none; border-radius: var(--radius-sm);
  background: var(--cs-white); font: var(--text-pc-body-14); color: var(--cs-text);
  -webkit-appearance: none; -moz-appearance: none; appearance: none;
}
.edit-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
.edit-name-in { min-width: 120px; flex: 1; }
.edit-desc-in2 { min-width: 160px; flex: 1.5; color: var(--cs-text-mid); }

/* 편집 키워드 영역 */
.edit-kw-wrap {
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
  flex: 2; min-width: 160px;
  min-height: 44px; padding: 8px 12px; box-sizing: border-box;
  background: var(--cs-white); border: none;
  border-radius: var(--radius-sm);
}
.edit-kw-wrap:focus-within {
  outline: 2px solid var(--cs-purple);
  outline-offset: -2px;
}
.edit-kw-chip {
  display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px;
  background: var(--cs-lilac); color: var(--cs-purple);
  border-radius: 4px; font: var(--text-pc-script-12);
}
.edit-kw-del { background: none; border: none; cursor: pointer; color: var(--cs-purple); font-size: 14px; line-height: 1; padding: 0 1px; }
.edit-kw-in {
  flex: 1; min-width: 100px; border: none; background: transparent;
  font: var(--text-pc-script-12); color: var(--cs-text); padding: 0 4px;
  outline: none; box-shadow: none;
}
.edit-kw-in:focus,
.edit-kw-in:focus-visible {
  outline: none;
  border: none;
  box-shadow: none;
}
.edit-kw-in::placeholder { color: var(--cs-text-light); font-size: 11px; }

/* 편집 Row2 — 년월 토글 */
.edit-toggle-wrap { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.edit-toggle {
  position: relative; width: 36px; height: 20px; border: none;
  border-radius: 10px; background: var(--cs-disabled-toggle); cursor: pointer; padding: 2px;
  transition: background 0.2s; flex-shrink: 0;
}
.edit-toggle.on { background: var(--cs-purple); }
.edit-toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: var(--cs-white); transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.edit-toggle.on .edit-toggle-thumb { transform: translateX(16px); }
.edit-toggle-lbl { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }

/* 편집 Row2 — 순번 제한 */
.edit-seq-field { display: flex; align-items: center; gap: 6px; }
.edit-seq-lbl { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.edit-seq-in { width: 80px; }
.edit-preview-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: rgba(59,47,138,0.04);
  border-radius: var(--radius-sm);
  margin-top: 4px;
}
.edit-prev-lbl  { font: var(--text-pc-script-12); color: var(--cs-text-mid); white-space: nowrap; }
.edit-prev-code { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-purple); letter-spacing: 0.05em; }


/* Prefix 설정 모달 */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(16,11,50,0.52);
  display: flex; align-items: center; justify-content: center;
}
.prefix-modal {
  background: var(--cs-white); border-radius: var(--radius-lg);
  width: 400px; max-width: 90vw; overflow: hidden;
}
.pm-header {
  display: flex; align-items: center; justify-content: flex-end;
  padding: 16px 20px 12px;
}
.pm-close {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: none; border-radius: 12px;
  background: var(--cs-lilac); color: var(--cs-text-mid); cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.pm-close:hover { color: var(--cs-text); background: rgba(59,47,138,0.08); }
.pm-body { padding: 0 20px; margin: 0 0 5px; display: flex; flex-direction: column; gap: 14px; }
.pm-section { display: flex; flex-direction: column; gap: 6px; }
.pm-hint { font: var(--text-pc-body-14); color: var(--cs-text-mid); margin: 0; }
.pm-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.pm-prefix-chip {
  display: inline-flex; align-items: stretch;
  border: 1px solid var(--cs-lilac); border-radius: var(--radius-sm); overflow: hidden;
}
.pm-prefix-chip.active { border-color: var(--cs-purple-dark); }
.pm-prefix-chip .ac-prefix-btn {
  border: none; border-radius: 0; height: 30px; padding: 0 14px;
}
.pm-prefix-chip.active .ac-prefix-btn {
  background: var(--cs-purple-dark); color: var(--cs-white);
}
.pm-prefix-del {
  width: 24px; height: 30px; padding: 0; border: none;
  border-left: 1px solid var(--cs-lilac); background: transparent;
  font: var(--text-pc-body-14); line-height: 1; color: var(--cs-text-mid); cursor: pointer;
}
.pm-prefix-del:hover:not(:disabled) {
  background: rgba(255,53,53,0.08); color: var(--cs-red-badge);
}
.pm-prefix-del:disabled { opacity: 0.35; cursor: not-allowed; }
.ac-prefix-btn {
  height: 30px; padding: 0 14px; border-radius: var(--radius-sm);
  border: 1px solid var(--cs-lilac); background: var(--cs-white); color: var(--cs-text);
  font: var(--text-pc-script-12); cursor: pointer; transition: background 0.12s;
}
.ac-prefix-btn.active { background: var(--cs-purple-dark); color: var(--cs-white); border-color: var(--cs-purple-dark); }
.fc-in {
  height: 40px; padding: 0 12px; border: 1.5px solid rgba(59,47,138,0.10);
  border-radius: var(--radius-sm); background: var(--cs-surface-gray);
  font: var(--text-pc-body-14); color: var(--cs-text); width: 110px;
}
.fc-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
.mono-in { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.pm-in { width: 100%; box-sizing: border-box; }
.pm-input-row { display: flex; align-items: center; gap: 8px; }
.pm-input-row .pm-in { flex: 1; min-width: 0; border: none; }
.pm-input-row .pm-in:focus { border: none; }
.pm-add-form { flex-shrink: 0; margin: 0; }
.pm-add-btn {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; padding: 0; border: none;
  border-radius: var(--radius-sm); background: var(--cs-purple); color: var(--cs-white);
  cursor: pointer; transition: background 0.12s;
}
.pm-add-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
.pm-add-btn:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
.pm-actions {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 20px 16px;
}

/* 이관 모달 */
.transfer-backdrop {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(16,11,50,0.52);
  display: flex; align-items: center; justify-content: center;
}
.transfer-dialog {
  background: var(--cs-white); border-radius: var(--cms-radius-lg);
  padding: 28px 32px; width: 480px; max-width: calc(100vw - 48px);
  display: flex; flex-direction: column; gap: 18px;
}
.td-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.td-title { font: var(--text-pc-title-18); color: var(--cs-text); margin: 0; }
.td-close-btn { border: none; background: transparent; cursor: pointer; color: var(--cs-text-light); padding: 2px; flex-shrink: 0; transition: color 0.12s; }
.td-close-btn:hover { color: var(--cs-text); }
.td-warn {
  display: flex; gap: 10px; padding: 12px 14px;
  background: rgba(245,158,11,0.08); border-radius: var(--cms-radius-sm); border-left: 3px solid var(--cs-warning);
}
.td-warn-txt { font: var(--text-pc-script-12); color: var(--cs-text-dark); line-height: 1.55; }
.td-warn-txt strong { color: var(--cs-text); font-weight: 700; }
.td-src { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--cs-lilac); border-radius: var(--cms-radius-sm); }
.td-src-label { font: var(--text-pc-descript-10); font-weight: 700; text-transform: uppercase; color: var(--cs-text-mid); letter-spacing: 0.08em; }
.td-src-code  { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
.td-src-count { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
.td-field label { font: var(--text-pc-script-12); color: var(--cs-text-mid); display: block; margin-bottom: 6px; }
.td-select {
  width: 100%; height: 40px; padding: 0 32px 0 12px;
  border: 1.5px solid rgba(59,47,138,0.15); border-radius: var(--radius-sm);
  background: var(--cs-surface-gray); font: var(--text-pc-body-14); color: var(--cs-text); cursor: pointer;
  -webkit-appearance: none; -moz-appearance: none; appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpolyline points='6,9 12,15 18,9'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
}
.td-select:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: transparent; }
.td-actions { display: flex; gap: 10px; justify-content: flex-end; }
.td-btn-cancel {
  height: 40px; padding: 0 20px; border: 1.5px solid var(--cs-border);
  border-radius: var(--radius-sm); background: transparent; color: var(--cs-text-mid);
  font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s;
}
.td-btn-cancel:hover { background: var(--cs-surface-gray); }
.td-btn-confirm {
  height: 40px; padding: 0 20px; border: none;
  border-radius: var(--radius-sm); background: var(--cs-warning); color: var(--cs-white);
  font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s;
}
.td-btn-confirm:hover  { background: #d97706; }
.td-btn-confirm:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }
</style>
