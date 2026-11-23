<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'
  import { HERO_MEDIA_ACCEPT, HERO_MEDIA_MAX_BYTES, hasMetaRefresh, heroBannerMediaKind } from '$lib/utils/heroBannerMedia'

  // ── 타입 ─────────────────────────────────────────────────────────
  interface SourceBanner {
    id: string
    title: string | null
    sub_copy: string | null
    image_url: string
    link_url: string | null
  }

  interface LocalBanner {
    _tempId: string       // CmsDragList 키 (로컬 전용)
    id: string | null     // DB id (null = 신규)
    title: string
    sub_copy: string
    image_url: string
    link_url: string
    _uploading: boolean
  }

  type Slot = 'pc' | 'mobile'

  // 통합 목록의 한 줄 — PC·모바일 이미지는 따로, 제목·서브카피·링크는 하나를 PC·모바일에 같이 저장한다
  interface SlotMedia {
    id: string | null     // DB id (null = 이 쪽 이미지 없음/신규)
    image_url: string
    _uploading: boolean
  }
  interface BannerRow {
    _tempId: string       // CmsDragList 키 (로컬 전용)
    title: string
    sub_copy: string
    link_url: string
    pc: SlotMedia
    mobile: SlotMedia
  }

  interface Props {
    pcBanners: SourceBanner[]
    mobileBanners: SourceBanner[]
    pcMode: 'random' | 'fixed'
    mobileMode: 'random' | 'fixed'
    pcFirstId: string | null
    mobileFirstId: string | null
    onclose: () => void
    /** 통합 설정 모달 안에 섹션으로 표시(오버레이·헤더·취소 숨김) */
    embedded?: boolean
  }

  // mobileMode 는 PC 기준으로 통합해 쓰지 않는다(호출부 호환을 위해 Props 에는 남김)
  let { pcBanners, mobileBanners, pcMode, pcFirstId, mobileFirstId, onclose, embedded = false }: Props = $props()

  const MAX = 10

  // ── 로컬 상태 ─────────────────────────────────────────────────────
  function emptyMedia(): SlotMedia {
    return { id: null, image_url: '', _uploading: false }
  }
  function mediaOf(b: SourceBanner | undefined): SlotMedia {
    return b ? { id: b.id, image_url: b.image_url, _uploading: false } : emptyMedia()
  }
  // 순번대로 PC·모바일 배너를 한 줄로 짝짓는다(개수가 다르면 남는 쪽은 반대편 이미지 없음).
  // 제목·서브카피·링크는 PC 값을 우선하고, 비어 있으면 모바일 값을 쓴다
  function toRows(pcList: SourceBanner[], mobileList: SourceBanner[]): BannerRow[] {
    const n = Math.max(pcList.length, mobileList.length)
    return Array.from({ length: n }, (_, i) => {
      const p = pcList[i]
      const m = mobileList[i]
      return {
        _tempId: p?.id ?? m?.id ?? crypto.randomUUID(),
        title: p?.title || m?.title || '',
        sub_copy: p?.sub_copy || m?.sub_copy || '',
        link_url: p?.link_url || m?.link_url || '',
        pc: mediaOf(p),
        mobile: mediaOf(m),
      }
    })
  }

  let rows = $state<BannerRow[]>([])
  // 노출 방식·'먼저 노출'은 PC·모바일 공통 하나(저장 시 두 슬롯에 같은 값 기록)
  let localMode = $state<'random' | 'fixed'>('fixed')
  // '먼저 노출' 배너(행 키 _tempId). 최대 1개
  let localFirst = $state<string | null>(null)
  let origPcIds = $state<Set<string>>(new Set())
  let origMobileIds = $state<Set<string>>(new Set())
  let isSaving = $state(false)
  let saveError = $state<string | null>(null)

  // prop 동기화 ($state(prop) 초기화 금지 — $effect 패턴 사용)
  $effect(() => {
    const next = toRows(pcBanners, mobileBanners)
    rows = next
    // 기존에 PC·모바일 설정이 달랐다면 PC 기준으로 통합
    localMode = pcMode
    localFirst =
      next.find((r) => r.pc.id !== null && r.pc.id === pcFirstId)?._tempId ??
      next.find((r) => r.mobile.id !== null && r.mobile.id === mobileFirstId)?._tempId ??
      null
    origPcIds = new Set(pcBanners.map((b) => b.id))
    origMobileIds = new Set(mobileBanners.map((b) => b.id))
  })

  // ── 행 추가 / 제거 ─────────────────────────────────────────────────
  function addBanner() {
    rows = [
      ...rows,
      { _tempId: crypto.randomUUID(), title: '', sub_copy: '', link_url: '', pc: emptyMedia(), mobile: emptyMedia() },
    ]
  }

  function removeBanner(tempId: string) {
    if (localFirst === tempId) localFirst = null
    rows = rows.filter((r) => r._tempId !== tempId)
  }

  // ── '먼저 노출' — 썸네일을 2초간 누르면(마우스·터치) 해당 배너를 토글. 짧게 누르면 기존처럼 파일 교체 ──
  const FIRST_HOLD_MS = 2000
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let holdFired = false

  function toggleFirst(tempId: string) {
    localFirst = localFirst === tempId ? null : tempId
  }
  function holdStart(r: BannerRow, slot: Slot) {
    holdFired = false
    clearTimeout(holdTimer)
    if (!r[slot].image_url || r[slot]._uploading) return
    holdTimer = setTimeout(() => { holdFired = true; toggleFirst(r._tempId) }, FIRST_HOLD_MS)
  }
  function holdCancel() { clearTimeout(holdTimer) }
  function thumbClick(e: MouseEvent) {
    if (!holdFired) return
    holdFired = false
    e.preventDefault()   // 2초 누름이 끝난 뒤의 클릭이 파일 선택창을 열지 않도록
  }

  function patchMedia(tempId: string, slot: Slot, patch: Partial<SlotMedia>) {
    rows = rows.map((r) => (r._tempId === tempId ? { ...r, [slot]: { ...r[slot], ...patch } } : r))
  }

  // ── 이미지 업로드 (행별) ────────────────────────────────────────────
  async function onImageChange(slot: Slot, tempId: string, e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    input.value = ''

    const mark = (upld: boolean) => patchMedia(tempId, slot, { _uploading: upld })

    const nameKind = heroBannerMediaKind(file.name)
    const mediaKind: 'html' | 'video' | null =
      file.type === 'video/mp4' || nameKind === 'video' ? 'video'
      : file.type === 'text/html' || nameKind === 'html' ? 'html'
      : null
    if (mediaKind && file.size > HERO_MEDIA_MAX_BYTES) {
      saveError = '파일 크기는 10MB 이하여야 합니다.'
      return
    }
    if (mediaKind === 'html' && hasMetaRefresh(await file.text())) {
      saveError = '다른 주소로 이동시키는 HTML(meta refresh)은 등록할 수 없어요.'
      return
    }
    saveError = null
    mark(true)
    let uploadedUrl: string | null = null
    try {
      if (mediaKind) {
        // HTML·MP4: 서버에서 업로드 허가증만 받고 파일은 저장소로 직접 올린다(큰 영상이 서버 요청 한도에 막히지 않도록)
        const signRes = await fetch('/api/cms/home/hero-banner', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: mediaKind }),
        })
        if (!signRes.ok) {
          saveError = signRes.status === 403
            ? 'HTML·영상은 매니저 이상만 등록할 수 있어요.'
            : '업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.'
        } else {
          const sign = (await signRes.json()) as { path: string; token: string; url: string }
          const { error: upErr } = await supabase.storage
            .from('home-hero-media')
            .uploadToSignedUrl(sign.path, sign.token, file, {
              contentType: mediaKind === 'html' ? 'text/html' : 'video/mp4',
            })
          if (upErr) saveError = '업로드에 실패했어요. 파일 형식과 크기(10MB 이하)를 확인해 주세요.'
          else uploadedUrl = sign.url
        }
      } else {
        const form = new FormData()
        form.set('file', file)
        const res = await fetch('/api/cms/home/hero-banner', { method: 'POST', body: form })
        if (res.ok) uploadedUrl = ((await res.json()) as { url: string }).url
        else if (res.status === 400) saveError = 'PNG, JPEG, WebP, HEIF, MP4, HTML 파일만 업로드할 수 있어요.'
        else saveError = '업로드에 실패했어요. 잠시 후 다시 시도해 주세요.'
      }
    } catch {
      saveError = '업로드에 실패했어요. 네트워크를 확인해 주세요.'
    }
    if (uploadedUrl) patchMedia(tempId, slot, { image_url: uploadedUrl })
    mark(false)
  }

  function updateField(tempId: string, field: 'title' | 'sub_copy' | 'link_url', value: string) {
    rows = rows.map((r) => (r._tempId === tempId ? { ...r, [field]: value } : r))
  }

  // ── RPC 헬퍼 ──────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function callRpc(name: string, params: Record<string, any>): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(name, params)
    if (error) return error.message
    if (data && typeof data === 'object' && 'ok' in data && !data.ok)
      return (data as { ok: false; error?: string }).error ?? 'RPC 오류'
    return null
  }

  async function saveBannerSlot(
    slot: 'pc' | 'mobile',
    localList: LocalBanner[],
    origIds: Set<string>,
  ): Promise<{ err: string | null; ids: Record<string, string> }> {
    const slotKey = slot === 'pc' ? 'hero_pc' : 'hero_mobile'
    const finalIds = new Set(localList.filter((b) => b.id).map((b) => b.id!))
    const ids: Record<string, string> = {}

    // 삭제된 배너 소프트삭제
    for (const id of origIds) {
      if (!finalIds.has(id)) {
        const err = await callRpc('cms_delete_banner', { p_id: id })
        if (err) return { err: `${slot.toUpperCase()} 배너 삭제 실패: ${err}`, ids }
      }
    }

    // 생성 / 수정
    for (let i = 0; i < localList.length; i++) {
      const b = localList[i]
      if (!b.image_url) continue  // 이미지 없는 신규 행 스킵
      if (b.id) {
        const err = await callRpc('cms_update_banner', {
          p_id: b.id,
          p_title: b.title,
          p_sub_copy: b.sub_copy || null,
          p_image_url: b.image_url,
          p_link_url: b.link_url || null,
          p_sort_order: i,
        })
        if (err) return { err: `${slot.toUpperCase()} 배너 수정 실패: ${err}`, ids }
        ids[b._tempId] = b.id
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('cms_create_banner', {
          p_slot_key: slotKey,
          p_title: b.title,
          p_sub_copy: b.sub_copy || null,
          p_image_url: b.image_url,
          p_link_url: b.link_url || null,
          p_sort_order: i,
        })
        const failed = error?.message ?? (data && typeof data === 'object' && 'ok' in data && !data.ok ? ((data as { error?: string }).error ?? 'RPC 오류') : null)
        if (failed) return { err: `${slot.toUpperCase()} 배너 생성 실패: ${failed}`, ids }
        const newId = (data as { id?: string } | null)?.id
        if (newId) ids[b._tempId] = newId
      }
    }
    return { err: null, ids }
  }

  // 한 줄의 PC·모바일 이미지를 슬롯별 배너 목록으로 나눈다(이미지 없는 쪽은 그 슬롯에서 제외 → 기존 행이면 삭제)
  function slotList(slot: Slot): LocalBanner[] {
    return rows
      .filter((r) => r[slot].image_url)
      .map((r) => ({
        _tempId: r._tempId,
        id: r[slot].id,
        title: r.title,
        sub_copy: r.sub_copy,
        image_url: r[slot].image_url,
        link_url: r.link_url,
        _uploading: false,
      }))
  }

  // 슬롯 저장 결과(행 키 → DB id)를 화면 상태에 반영 — 중간에 실패해 같은 화면에서 다시 저장해도 이미 만든 배너를 또 만들지 않는다
  function applySavedIds(slot: Slot, ids: Record<string, string>) {
    rows = rows.map((r) => (ids[r._tempId] ? { ...r, [slot]: { ...r[slot], id: ids[r._tempId] } } : r))
    const saved = new Set(Object.values(ids))
    if (slot === 'pc') origPcIds = saved
    else origMobileIds = saved
  }

  async function save() {
    if (rows.some((r) => r.pc._uploading || r.mobile._uploading)) {
      saveError = '이미지 업로드가 끝난 뒤 저장해 주세요.'
      return
    }
    isSaving = true
    saveError = null
    try {
      const pcRes = await saveBannerSlot('pc', slotList('pc'), origPcIds)
      applySavedIds('pc', pcRes.ids)
      if (pcRes.err) { saveError = pcRes.err; return }

      const mobileRes = await saveBannerSlot('mobile', slotList('mobile'), origMobileIds)
      applySavedIds('mobile', mobileRes.ids)
      if (mobileRes.err) { saveError = mobileRes.err; return }

      // 설정 저장 — 노출 방식·먼저 노출은 PC·모바일 공통 값을 두 슬롯에 같이 기록
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: settingsErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key: 'home_hero_banner_settings',
        p_value: {
          pc_mode: localMode,
          mobile_mode: localMode,
          pc_first_id: localFirst ? (pcRes.ids[localFirst] ?? null) : null,
          mobile_first_id: localFirst ? (mobileRes.ids[localFirst] ?? null) : null,
        },
      })
      if (settingsErr) { saveError = `설정 저장 실패: ${settingsErr.message}`; return }

      await invalidateAll()
      onclose()
    } catch (e) {
      saveError = e instanceof Error ? e.message : '저장 실패'
    } finally {
      isSaving = false
    }
  }
</script>

{#if !embedded}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onclose} role="presentation"></div>
{/if}

<aside class="modal-panel" class:embedded role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="홈 히어로 배너 관리">
  {#if !embedded}
    <div class="modal-header">
      <span class="modal-title">홈 히어로 배너 관리</span>
      <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
    </div>
  {/if}

  <div class="modal-body">

    <div class="section">
      <p class="section-label">홈 히어로 배너 <span class="hint">PC·모바일 공통</span></p>
      <div class="mode-chips">
        <button type="button" class="mode-chip" class:mode-chip--on={localMode === 'fixed'} aria-pressed={localMode === 'fixed'} onclick={() => (localMode = 'fixed')}>순서대로 노출</button>
        <button type="button" class="mode-chip" class:mode-chip--on={localMode === 'random'} aria-pressed={localMode === 'random'} onclick={() => (localMode = 'random')}>랜덤 노출</button>
      </div>
      <p class="spec-note">PC 권장 1920×936px (가로형). 위 100px · 아래 80px · 좌우 10%에는 중요한 글자를 두지 마세요.</p>
      <p class="spec-note">모바일 권장 1170×2160px (세로형). 위 80px · 아래 100px · 좌우 10%에는 중요한 글자를 두지 마세요.</p>
    </div>

    {#snippet thumb(r: BannerRow, slot: Slot)}
      <label
        class="thumb-wrap"
        title="{slot === 'pc' ? 'PC' : '모바일'} 이미지 — 클릭하여 교체 · 2초간 누르면 먼저 노출"
        onpointerdown={() => holdStart(r, slot)}
        onpointerup={holdCancel}
        onpointerleave={holdCancel}
        onpointercancel={holdCancel}
        onclick={thumbClick}
        oncontextmenu={(e) => e.preventDefault()}
      >
        {#if localFirst === r._tempId && r[slot].image_url}<span class="first-badge">먼저 노출</span>{/if}
        <span class="slot-tag">{slot === 'pc' ? 'PC' : '모바일'}</span>
        {#if r[slot]._uploading}
          <div class="thumb-uploading">업로드 중…</div>
        {:else if r[slot].image_url && heroBannerMediaKind(r[slot].image_url) === 'video'}
          <video src={r[slot].image_url} class="banner-thumb" muted playsinline preload="metadata"></video>
        {:else if r[slot].image_url && heroBannerMediaKind(r[slot].image_url) === 'html'}
          <div class="thumb-empty">HTML</div>
        {:else if r[slot].image_url}
          <img src={r[slot].image_url} alt={r.title || 'banner'} class="banner-thumb" />
        {:else}
          <div class="thumb-empty">이미지 없음</div>
        {/if}
        <input
          type="file"
          class="hidden-input"
          accept={HERO_MEDIA_ACCEPT}
          onchange={(e) => onImageChange(slot, r._tempId, e)}
        />
      </label>
    {/snippet}

    {#if rows.length > 0}
      <div class="section">
        <p class="section-label sub">배너 목록 <span class="hint">드래그로 순서 변경 · 최대 {MAX}개</span></p>
        <CmsDragList bind:items={rows} itemKey={(r) => r._tempId} class="hero-drag-list">
          {#snippet renderItem(r)}
            <div class="banner-row">
              <div class="thumbs">
                {@render thumb(r, 'pc')}
                {@render thumb(r, 'mobile')}
              </div>
              <div class="banner-fields">
                <input
                  type="text"
                  class="cms-field"
                  placeholder="제목 (alt 텍스트)"
                  value={r.title}
                  oninput={(e) => updateField(r._tempId, 'title', (e.target as HTMLInputElement).value)}
                />
                <input
                  type="text"
                  class="cms-field"
                  placeholder="서브카피 (선택)"
                  value={r.sub_copy}
                  oninput={(e) => updateField(r._tempId, 'sub_copy', (e.target as HTMLInputElement).value)}
                />
                <input
                  type="url"
                  class="cms-field"
                  placeholder="링크 URL (선택)"
                  value={r.link_url}
                  oninput={(e) => updateField(r._tempId, 'link_url', (e.target as HTMLInputElement).value)}
                />
              </div>
              <button
                class="btn-remove"
                onclick={() => removeBanner(r._tempId)}
                aria-label="배너 삭제"
              >✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-msg">배너를 추가하면 PC·모바일 히어로에 표시됩니다.</p>
    {/if}

    {#if rows.length < MAX}
      <button class="btn-add" onclick={addBanner}>+ 배너 추가</button>
    {:else}
      <p class="max-warn">최대 {MAX}개 배너입니다</p>
    {/if}

    {#if saveError}
      <p class="save-error" role="alert">{saveError}</p>
    {/if}
  </div>

  <div class="modal-footer">
    {#if !embedded}<button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>{/if}
    <button class="btn-save" onclick={save} disabled={isSaving}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  /* 통합 설정 모달 안에 섹션으로 박히는 모드(embedded) — 오버레이·헤더 없이 본문 흐름에 배치 */
  .modal-panel.embedded { position: static; height: auto; width: auto; max-width: none; z-index: auto; border-radius: 0; box-shadow: none; background: transparent; display: block; overflow: visible; }
  .modal-panel.embedded .modal-body { overflow: visible; flex: none; }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16, 11, 50, 0.3);
  }

  .modal-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100dvh;
    width: 420px;
    max-width: 100vw;
    z-index: 201;
    background: var(--cs-white);
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    box-shadow: -4px 0 24px rgba(16, 11, 50, 0.15);
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    background: var(--cs-dark);
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    border-radius: var(--radius-2xl) 0 0 0;
  }

  .modal-title {
    color: var(--cs-white);
    font: var(--text-pc-title-16);
  }

  .modal-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    min-height: 32px;
  }
  .modal-close:hover { color: var(--cs-white); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section { display: flex; flex-direction: column; gap: 8px; }

  .section-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
  }
  .section-label.sub {
    font-size: 12px;
    font-weight: 600;
    color: var(--cs-text-mid);
  }

  .hint {
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-light);
  }

  .spec-note {
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-mid);
    line-height: 1.6;
    margin: 0;
  }

  /* 옵션 선택 콤보버튼 — cms-uiux.md §7-12-B(mk-chip) 표준 그대로 */
  .mode-chips { display: flex; gap: 8px; }
  .mode-chip {
    height: 32px;
    padding: 0 14px;
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--cms-radius-xl, 30px);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .mode-chip--on {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }
  .mode-chip:not(.mode-chip--on):hover {
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }

  /* ── 배너 행 ─────────────────────────────────────── */
  /* 배너 목록 행 사이 간격 + 호버 모션(공용 CmsDragList 는 건드리지 않고 이 목록 클래스로만 지정) */
  :global(.hero-drag-list) { gap: 12px; }
  .banner-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    transition: background 0.18s ease, transform 0.18s ease;
  }
  :global(.hero-drag-list .drag-list-item:hover) .banner-row {
    background: var(--cs-lilac);
    transform: translateY(-2px);
  }
  @media (prefers-reduced-motion: reduce) {
    .banner-row { transition: background 0.18s ease; }
    :global(.hero-drag-list .drag-list-item:hover) .banner-row { transform: none; }
  }

  /* PC·모바일 이미지 두 칸을 세로로 */
  .thumbs {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .slot-tag {
    position: absolute;
    bottom: 3px;
    left: 3px;
    z-index: 1;
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--cs-dark);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    line-height: 1.3;
    pointer-events: none;
  }

  .thumb-wrap {
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    flex-shrink: 0;
    width: 64px;
    height: 48px;
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    background: var(--cs-lilac);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .first-badge {
    position: absolute;
    top: 3px;
    left: 3px;
    z-index: 1;
    padding: 2px 5px;
    border-radius: 5px;
    background: var(--cs-purple);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    line-height: 1.3;
    pointer-events: none;
  }

  .banner-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-empty {
    font-size: 10px;
    color: var(--cs-text-light);
    text-align: center;
    padding: 4px;
    line-height: 1.3;
  }

  .thumb-uploading {
    font-size: 10px;
    color: var(--cs-purple);
    text-align: center;
    padding: 4px;
    line-height: 1.3;
  }

  .hidden-input { display: none; }

  .banner-fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  /* cms-field 표준(§0-A #8)에서 세로폭·폰트만 줄임(2026-11-10 Stephen 지시 — 배너 목록 한 행이 길어지는 문제). 가로폭·배경·반경은 표준 유지 */
  .cms-field {
    width: 100%;
    min-height: 32px;
    padding: 0 12px;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    line-height: 1.4;
    color: var(--cs-text);
    box-sizing: border-box;
  }
  .cms-field:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }
  .cms-field::placeholder { color: var(--cs-text-light); }

  .btn-remove {
    background: none;
    border: none;
    color: var(--cs-text-mid);
    cursor: pointer;
    min-height: 32px;
    min-width: 28px;
    flex-shrink: 0;
    font-size: 14px;
    padding: 0 4px;
    align-self: flex-start;
    margin-top: 8px;
  }
  .btn-remove:hover { color: var(--cs-red-badge); }

  /* ── 추가 버튼 ─────────────────────────────────────── */
  .btn-add {
    height: 36px;
    padding: 0 16px;
    background: none;
    border: 1.5px dashed var(--cs-purple);
    border-radius: var(--radius-md);
    color: var(--cs-purple);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    align-self: stretch;   /* 가로폭 확대 — 배너 목록 폭에 맞춰 가득 채움 */
  }
  .btn-add:hover { background: rgba(59, 47, 138, 0.06); }

  .max-warn {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    margin: 0;
  }

  .empty-msg {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
    line-height: 1.6;
  }

  .save-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    margin: 0;
  }

  /* ── 푸터 ─────────────────────────────────────────── */
  .modal-footer {
    padding: 16px 24px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    border-top: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }

  .btn-cancel {
    height: 36px;
    padding: 0 20px;
    background: none;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    cursor: pointer;
  }
  .btn-cancel:hover { border-color: var(--cs-text-mid); }
  .btn-cancel:disabled { opacity: 0.5; cursor: default; }

  .btn-save {
    height: 36px;
    padding: 0 24px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
  }
  .btn-save:disabled { opacity: 0.5; cursor: default; }
</style>
