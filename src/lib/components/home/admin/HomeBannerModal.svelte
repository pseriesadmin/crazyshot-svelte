<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import CmsDragList from '$lib/components/cms/CmsDragList.svelte'

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

  interface Props {
    pcBanners: SourceBanner[]
    mobileBanners: SourceBanner[]
    pcMode: 'random' | 'fixed'
    mobileMode: 'random' | 'fixed'
    onclose: () => void
  }

  let { pcBanners, mobileBanners, pcMode, mobileMode, onclose }: Props = $props()

  const MAX = 10

  function toLocal(banners: SourceBanner[]): LocalBanner[] {
    return banners.map((b) => ({
      _tempId: b.id,
      id: b.id,
      title: b.title ?? '',
      sub_copy: b.sub_copy ?? '',
      image_url: b.image_url,
      link_url: b.link_url ?? '',
      _uploading: false,
    }))
  }

  // ── 로컬 상태 ─────────────────────────────────────────────────────
  let localPc = $state<LocalBanner[]>([])
  let localMobile = $state<LocalBanner[]>([])
  let localPcMode = $state<'random' | 'fixed'>('fixed')
  let localMobileMode = $state<'random' | 'fixed'>('fixed')
  let origPcIds = $state<Set<string>>(new Set())
  let origMobileIds = $state<Set<string>>(new Set())
  let isSaving = $state(false)
  let saveError = $state<string | null>(null)

  // prop 동기화 ($state(prop) 초기화 금지 — $effect 패턴 사용)
  $effect(() => {
    localPc = toLocal(pcBanners)
    localMobile = toLocal(mobileBanners)
    localPcMode = pcMode
    localMobileMode = mobileMode
    origPcIds = new Set(pcBanners.map((b) => b.id))
    origMobileIds = new Set(mobileBanners.map((b) => b.id))
  })

  // ── 행 추가 / 제거 ─────────────────────────────────────────────────
  function addBanner(slot: 'pc' | 'mobile') {
    const newRow: LocalBanner = {
      _tempId: crypto.randomUUID(),
      id: null,
      title: '',
      sub_copy: '',
      image_url: '',
      link_url: '',
      _uploading: false,
    }
    if (slot === 'pc') localPc = [...localPc, newRow]
    else localMobile = [...localMobile, newRow]
  }

  function removeBanner(slot: 'pc' | 'mobile', tempId: string) {
    if (slot === 'pc') localPc = localPc.filter((b) => b._tempId !== tempId)
    else localMobile = localMobile.filter((b) => b._tempId !== tempId)
  }

  // ── 이미지 업로드 (행별) ────────────────────────────────────────────
  async function onImageChange(slot: 'pc' | 'mobile', tempId: string, e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    input.value = ''

    const mark = (upld: boolean) => {
      const update = (list: LocalBanner[]) =>
        list.map((b) => (b._tempId === tempId ? { ...b, _uploading: upld } : b))
      if (slot === 'pc') localPc = update(localPc)
      else localMobile = update(localMobile)
    }

    mark(true)
    const form = new FormData()
    form.set('file', file)
    const res = await fetch('/api/cms/home/hero-banner', { method: 'POST', body: form })
    if (res.ok) {
      const { url } = (await res.json()) as { url: string; path: string }
      const update = (list: LocalBanner[]) =>
        list.map((b) => (b._tempId === tempId ? { ...b, image_url: url } : b))
      if (slot === 'pc') localPc = update(localPc)
      else localMobile = update(localMobile)
    }
    mark(false)
  }

  function updateField(
    slot: 'pc' | 'mobile',
    tempId: string,
    field: keyof Pick<LocalBanner, 'title' | 'sub_copy' | 'link_url'>,
    value: string,
  ) {
    const update = (list: LocalBanner[]) =>
      list.map((b) => (b._tempId === tempId ? { ...b, [field]: value } : b))
    if (slot === 'pc') localPc = update(localPc)
    else localMobile = update(localMobile)
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
  ): Promise<string | null> {
    const slotKey = slot === 'pc' ? 'hero_pc' : 'hero_mobile'
    const finalIds = new Set(localList.filter((b) => b.id).map((b) => b.id!))

    // 삭제된 배너 소프트삭제
    for (const id of origIds) {
      if (!finalIds.has(id)) {
        const err = await callRpc('cms_delete_banner', { p_id: id })
        if (err) return `${slot.toUpperCase()} 배너 삭제 실패: ${err}`
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
        if (err) return `${slot.toUpperCase()} 배너 수정 실패: ${err}`
      } else {
        const err = await callRpc('cms_create_banner', {
          p_slot_key: slotKey,
          p_title: b.title,
          p_sub_copy: b.sub_copy || null,
          p_image_url: b.image_url,
          p_link_url: b.link_url || null,
          p_sort_order: i,
        })
        if (err) return `${slot.toUpperCase()} 배너 생성 실패: ${err}`
      }
    }
    return null
  }

  async function save() {
    isSaving = true
    saveError = null
    try {
      const pcErr = await saveBannerSlot('pc', localPc, origPcIds)
      if (pcErr) { saveError = pcErr; return }

      const mobileErr = await saveBannerSlot('mobile', localMobile, origMobileIds)
      if (mobileErr) { saveError = mobileErr; return }

      // 설정 저장
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: settingsErr } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key: 'home_hero_banner_settings',
        p_value: { pc_mode: localPcMode, mobile_mode: localMobileMode },
      })
      if (settingsErr) { saveError = `설정 저장 실패: ${settingsErr.message}`; return }

      await invalidateAll()
      onclose()
    } catch (e) {
      saveError = e instanceof Error ? e.message : '저장 실패'
    }
    isSaving = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="홈 히어로 배너 관리">
  <div class="modal-header">
    <span class="modal-title">홈 히어로 배너 관리</span>
    <button class="modal-close" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">

    <!-- ── PC 배너 섹션 ──────────────────────────────────────── -->
    <div class="section">
      <p class="section-label">PC 배너 <span class="hint">데스크탑 히어로 영역</span></p>
      <div class="radio-group">
        <label class="radio-opt">
          <input
            type="radio" name="pc-mode" value="fixed"
            checked={localPcMode === 'fixed'}
            onchange={() => (localPcMode = 'fixed')}
          />
          <span>순서대로 노출</span>
        </label>
        <label class="radio-opt">
          <input
            type="radio" name="pc-mode" value="random"
            checked={localPcMode === 'random'}
            onchange={() => (localPcMode = 'random')}
          />
          <span>랜덤 노출</span>
        </label>
      </div>
    </div>

    {#if localPc.length > 0}
      <div class="section">
        <p class="section-label sub">배너 목록 <span class="hint">드래그로 순서 변경 · 최대 {MAX}개</span></p>
        <CmsDragList bind:items={localPc} itemKey={(b) => b._tempId}>
          {#snippet renderItem(b)}
            <div class="banner-row">
              <label class="thumb-wrap" title="클릭하여 이미지 교체">
                {#if b._uploading}
                  <div class="thumb-uploading">업로드 중…</div>
                {:else if b.image_url}
                  <img src={b.image_url} alt={b.title || 'banner'} class="banner-thumb" />
                {:else}
                  <div class="thumb-empty">이미지 없음</div>
                {/if}
                <input
                  type="file"
                  class="hidden-input"
                  accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
                  onchange={(e) => onImageChange('pc', b._tempId, e)}
                />
              </label>
              <div class="banner-fields">
                <input
                  type="text"
                  class="cms-field"
                  placeholder="제목 (alt 텍스트)"
                  value={b.title}
                  oninput={(e) => updateField('pc', b._tempId, 'title', (e.target as HTMLInputElement).value)}
                />
                <input
                  type="text"
                  class="cms-field"
                  placeholder="서브카피 (선택)"
                  value={b.sub_copy}
                  oninput={(e) => updateField('pc', b._tempId, 'sub_copy', (e.target as HTMLInputElement).value)}
                />
                <input
                  type="url"
                  class="cms-field"
                  placeholder="링크 URL (선택)"
                  value={b.link_url}
                  oninput={(e) => updateField('pc', b._tempId, 'link_url', (e.target as HTMLInputElement).value)}
                />
              </div>
              <button
                class="btn-remove"
                onclick={() => removeBanner('pc', b._tempId)}
                aria-label="배너 삭제"
              >✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-msg">PC 배너를 추가하면 데스크탑 히어로에 표시됩니다.</p>
    {/if}

    {#if localPc.length < MAX}
      <button class="btn-add" onclick={() => addBanner('pc')}>+ PC 배너 추가</button>
    {:else}
      <p class="max-warn">최대 {MAX}개 배너입니다</p>
    {/if}

    <div class="divider"></div>

    <!-- ── 모바일 배너 섹션 ───────────────────────────────────── -->
    <div class="section">
      <p class="section-label">모바일 배너 <span class="hint">모바일 히어로 영역</span></p>
      <div class="radio-group">
        <label class="radio-opt">
          <input
            type="radio" name="mobile-mode" value="fixed"
            checked={localMobileMode === 'fixed'}
            onchange={() => (localMobileMode = 'fixed')}
          />
          <span>순서대로 노출</span>
        </label>
        <label class="radio-opt">
          <input
            type="radio" name="mobile-mode" value="random"
            checked={localMobileMode === 'random'}
            onchange={() => (localMobileMode = 'random')}
          />
          <span>랜덤 노출</span>
        </label>
      </div>
    </div>

    {#if localMobile.length > 0}
      <div class="section">
        <p class="section-label sub">배너 목록 <span class="hint">드래그로 순서 변경 · 최대 {MAX}개</span></p>
        <CmsDragList bind:items={localMobile} itemKey={(b) => b._tempId}>
          {#snippet renderItem(b)}
            <div class="banner-row">
              <label class="thumb-wrap" title="클릭하여 이미지 교체">
                {#if b._uploading}
                  <div class="thumb-uploading">업로드 중…</div>
                {:else if b.image_url}
                  <img src={b.image_url} alt={b.title || 'banner'} class="banner-thumb" />
                {:else}
                  <div class="thumb-empty">이미지 없음</div>
                {/if}
                <input
                  type="file"
                  class="hidden-input"
                  accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
                  onchange={(e) => onImageChange('mobile', b._tempId, e)}
                />
              </label>
              <div class="banner-fields">
                <input
                  type="text"
                  class="cms-field"
                  placeholder="제목 (alt 텍스트)"
                  value={b.title}
                  oninput={(e) => updateField('mobile', b._tempId, 'title', (e.target as HTMLInputElement).value)}
                />
                <input
                  type="text"
                  class="cms-field"
                  placeholder="서브카피 (선택)"
                  value={b.sub_copy}
                  oninput={(e) => updateField('mobile', b._tempId, 'sub_copy', (e.target as HTMLInputElement).value)}
                />
                <input
                  type="url"
                  class="cms-field"
                  placeholder="링크 URL (선택)"
                  value={b.link_url}
                  oninput={(e) => updateField('mobile', b._tempId, 'link_url', (e.target as HTMLInputElement).value)}
                />
              </div>
              <button
                class="btn-remove"
                onclick={() => removeBanner('mobile', b._tempId)}
                aria-label="배너 삭제"
              >✕</button>
            </div>
          {/snippet}
        </CmsDragList>
      </div>
    {:else}
      <p class="empty-msg">모바일 배너를 추가하면 모바일 히어로에 표시됩니다.</p>
    {/if}

    {#if localMobile.length < MAX}
      <button class="btn-add" onclick={() => addBanner('mobile')}>+ 모바일 배너 추가</button>
    {:else}
      <p class="max-warn">최대 {MAX}개 배너입니다</p>
    {/if}

    {#if saveError}
      <p class="save-error" role="alert">{saveError}</p>
    {/if}
  </div>

  <div class="modal-footer">
    <button class="btn-cancel" onclick={onclose} disabled={isSaving}>취소</button>
    <button class="btn-save" onclick={save} disabled={isSaving}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
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

  .divider {
    height: 1px;
    background: var(--cs-lilac);
    margin: 4px 0;
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

  .radio-group { display: flex; gap: 16px; }
  .radio-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
  }

  /* ── 배너 행 ─────────────────────────────────────── */
  .banner-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
  }

  .thumb-wrap {
    flex-shrink: 0;
    width: 64px;
    height: 52px;
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    background: var(--cs-lilac);
    display: flex;
    align-items: center;
    justify-content: center;
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

  .cms-field {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    box-sizing: border-box;
  }
  .cms-field:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
    border-color: transparent;
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
    align-self: flex-start;
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
