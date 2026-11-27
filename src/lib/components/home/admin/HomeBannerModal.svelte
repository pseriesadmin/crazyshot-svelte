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
    is_active?: boolean   // 홈에 노출 중인지(없으면 노출로 간주)
  }

  interface LocalBanner {
    _tempId: string       // CmsDragList 키 (로컬 전용)
    id: string | null     // DB id (null = 신규)
    title: string
    sub_copy: string
    image_url: string
    link_url: string
    _uploading: boolean
    is_active: boolean    // 저장할 노출 여부(한 줄 단위로 PC·모바일 공통)
    cur_active: boolean   // 지금 DB 에 저장돼 있는 노출 여부(신규는 노출)
  }

  type Slot = 'pc' | 'mobile'

  // 통합 목록의 한 줄 — PC·모바일 이미지는 따로, 제목·서브카피·링크는 하나를 PC·모바일에 같이 저장한다
  interface SlotMedia {
    id: string | null     // DB id (null = 이 쪽 이미지 없음/신규)
    image_url: string
    _uploading: boolean
    active: boolean       // 이 쪽 배너의 DB 노출 여부(신규는 true)
  }
  interface BannerRow {
    _tempId: string       // CmsDragList 키 (로컬 전용)
    title: string
    sub_copy: string
    link_url: string
    active: boolean       // 기본노출지정 — 꺼지면 사용자 홈에 노출되지 않음(PC·모바일 공통)
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
    return { id: null, image_url: '', _uploading: false, active: true }
  }
  function mediaOf(b: SourceBanner | undefined): SlotMedia {
    return b ? { id: b.id, image_url: b.image_url, _uploading: false, active: b.is_active !== false } : emptyMedia()
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
        active: (p ? p.is_active !== false : m ? m.is_active !== false : true),
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
      { _tempId: crypto.randomUUID(), title: '', sub_copy: '', link_url: '', active: true, pc: emptyMedia(), mobile: emptyMedia() },
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

  // 상단 바의 두 칸은 각자 선택/미선택 상태를 가진다:
  //  · 우선노출지정(왼쪽) — 한 장만: 다른 배너를 선택하면 이전 지정은 해지. 숨김 상태인 배너는 선택할 수 없다(비활성)
  //  · 기본노출지정(오른쪽) — 홈 노출(켜짐) ↔ 숨김(꺼짐). 숨기면 그 배너의 우선노출 지정은 함께 풀린다(홈에 안 나오는 배너가 우선노출로 남지 않게)
  function toggleFirst(tempId: string) {
    if (!rows.find((r) => r._tempId === tempId)?.active) return   // 숨김 상태는 우선노출 지정 불가(2초 누르기 포함)
    localFirst = localFirst === tempId ? null : tempId
  }
  function toggleActive(tempId: string) {
    const nextActive = !rows.find((r) => r._tempId === tempId)?.active
    rows = rows.map((r) => (r._tempId === tempId ? { ...r, active: nextActive } : r))
    if (!nextActive && localFirst === tempId) localFirst = null
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
  ): Promise<{ err: string | null; ids: Record<string, string>; act: Record<string, boolean> }> {
    const slotKey = slot === 'pc' ? 'hero_pc' : 'hero_mobile'
    const finalIds = new Set(localList.filter((b) => b.id).map((b) => b.id!))
    const ids: Record<string, string> = {}
    const act: Record<string, boolean> = {}   // 서버에서 실제로 확인된 노출 여부(토글 실패 시 화면 값과 어긋나지 않게)

    // 삭제된 배너 소프트삭제
    for (const id of origIds) {
      if (!finalIds.has(id)) {
        const err = await callRpc('cms_delete_banner', { p_id: id })
        if (err) return { err: `${slot.toUpperCase()} 배너 삭제 실패: ${err}`, ids, act }
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
        if (err) return { err: `${slot.toUpperCase()} 배너 수정 실패: ${err}`, ids, act }
        ids[b._tempId] = b.id
        act[b._tempId] = b.cur_active
        if (b.is_active !== b.cur_active) {
          const tErr = await callRpc('cms_toggle_banner', { p_id: b.id })   // 노출 여부는 토글 RPC 로만 바뀐다(현재 값과 다를 때만 호출)
          if (tErr) return { err: `${slot.toUpperCase()} 배너 노출 변경 실패: ${tErr}`, ids, act }
          act[b._tempId] = b.is_active
        }
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
        if (failed) return { err: `${slot.toUpperCase()} 배너 생성 실패: ${failed}`, ids, act }
        const newId = (data as { id?: string } | null)?.id
        if (newId) {
          ids[b._tempId] = newId
          act[b._tempId] = true   // 새 배너는 노출 상태로 만들어진다
          if (!b.is_active) {
            const tErr = await callRpc('cms_toggle_banner', { p_id: newId })   // 숨김이면 한 번 토글
            if (tErr) return { err: `${slot.toUpperCase()} 배너 노출 변경 실패: ${tErr}`, ids, act }
            act[b._tempId] = false
          }
        }
      }
    }
    return { err: null, ids, act }
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
        is_active: r.active,
        cur_active: r[slot].active,
      }))
  }

  // 슬롯 저장 결과(행 키 → DB id)를 화면 상태에 반영 — 중간에 실패해 같은 화면에서 다시 저장해도 이미 만든 배너를 또 만들지 않는다
  function applySavedIds(slot: Slot, ids: Record<string, string>, act: Record<string, boolean>) {
    // active 는 서버에서 확인된 값만 반영 — 노출 변경이 실패했으면 다음 저장에서 다시 시도된다
    rows = rows.map((r) => (ids[r._tempId] ? { ...r, [slot]: { ...r[slot], id: ids[r._tempId], active: act[r._tempId] ?? r[slot].active } } : r))
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
      applySavedIds('pc', pcRes.ids, pcRes.act)
      if (pcRes.err) { saveError = pcRes.err; return }

      const mobileRes = await saveBannerSlot('mobile', slotList('mobile'), origMobileIds)
      applySavedIds('mobile', mobileRes.ids, mobileRes.act)
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
              <!-- 상단 바(절반씩): 왼쪽 우선노출지정(한 장만, 다른 배너를 선택하면 이전 지정 해지) / 오른쪽 기본노출지정(홈 노출 ↔ 숨김, 테마 그룹의 노출 체크 아이콘과 같은 로직) -->
              <div class="first-bars">
                <button
                  type="button"
                  class="first-bar"
                  class:first-bar--on={localFirst === r._tempId}
                  aria-pressed={localFirst === r._tempId}
                  aria-label="우선노출지정"
                  title={!r.active ? '숨김 상태에서는 우선노출을 지정할 수 없습니다' : localFirst === r._tempId ? '우선노출지정됨 — 다시 누르면 해지' : '우선노출지정 — 사용자 화면을 열 때 이 배너를 먼저 노출'}
                  disabled={!r.active || (!r.pc.image_url && !r.mobile.image_url)}
                  onclick={() => toggleFirst(r._tempId)}
                >우선노출지정</button>
                <button
                  type="button"
                  class="first-bar first-bar--visible"
                  class:first-bar--on={r.active}
                  aria-pressed={r.active}
                  aria-label={r.active ? '노출 중 — 클릭 시 숨김' : '숨김 — 클릭 시 노출'}
                  title={r.active ? '노출 중 — 클릭 시 숨김' : '숨김 — 클릭 시 노출'}
                  onclick={() => toggleActive(r._tempId)}
                >
                  <!-- 노출 체크 아이콘(HomeThemeGroupModal 의 노출 버튼과 같은 도형) -->
<span class="vis-ico">
                                      <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                    <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor"/>
                  </svg>
                  </span>
                  기본노출지정
                </button>
              </div>
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
                <button
                  type="button"
                  class="btn-remove"
                  onclick={() => removeBanner(r._tempId)}
                  aria-label="배너 삭제"
                  title="배너 삭제"
                >
                  <!-- CMS 공통 표준 삭제 아이콘(CmsDeleteButton 의 휴지통 SVG 12×12) -->
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <polyline points="3,6 5,6 21,6"/>
                    <path d="M19,6l-1,14H6L5,6"/>
                    <path d="M10,11v6M14,11v6"/>
                    <path d="M9,6V4h6v2"/>
                  </svg>
                </button>
              </div>
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
    color: var(--cs-text-mid);
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
  :global(.hero-drag-list) { gap: 24px; }
  .banner-row {
    flex: 1;          /* 드래그 목록 행(손잡이 + 카드)의 남는 가로폭을 카드가 채운다 */
    flex-wrap: wrap;  /* 첫 줄 = 우선노출지정 바, 둘째 줄 = 썸네일·입력칸·삭제 */
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    row-gap: 0;       /* 줄 사이 간격은 바의 margin-bottom(10px)으로만 */
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

  /* 카드 상단 바(가로 전체, 절반씩): 왼쪽 우선노출지정 / 오른쪽 기본노출지정. 각 칸 미선택 옅은 회색(--cs-border) / 선택 옅은 퍼플(--cs-purple-op10) */
  .first-bars {
    display: flex;
    flex: 0 0 calc(100% + 20px);   /* 카드 안쪽 여백(좌우 10px)을 덮어 상단 끝까지 */
    margin: -10px -10px 10px;      /* 위·좌우 여백 상쇄, 아래로 기존 여백 10px */
  }
  .first-bar {
    flex: 1;                       /* 절반씩 */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    box-sizing: content-box;
    height: 30px;                  /* 노출 아이콘 버튼(30px)이 들어가도록 글자 영역 30px + 위아래 안쪽 여백 5px씩 = 바 전체 40px */
    padding: 5px 0;
    border: none;
    border-radius: 0;
    background: var(--cs-border);
    color: var(--cs-text-mid);
    font: var(--text-pc-descript-10); /* 한 단계 작은 볼드 없는 토큰(300 10px) */
    line-height: 15px;                /* 토큰의 줄 높이(160%) 대신 바 높이에 맞춤 */
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease;
  }
  .first-bar:first-child { border-top-left-radius: var(--radius-sm); }
  .first-bar:last-child { border-top-right-radius: var(--radius-sm); }
  .first-bar--on { background: var(--cs-purple-op10); color: var(--cs-purple-dark); }   /* 선택: 더 옅은 퍼플(#E1DEF3) */
  .first-bar:disabled { cursor: not-allowed; opacity: 0.5; }
  /* 오른쪽 칸의 노출 아이콘 — 기존 노출 버튼(HomeThemeGroupModal .tg-visible-btn)의 버튼형 UI: 30×30 · 반경 8px · 아이콘 18×12 · 호버 옅은 퍼플 면, 노출이면 --cs-purple / 숨김이면 옅은 색 */
  .vis-ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm, 8px);
    color: var(--cs-purple-op10, #ECEBF4);
    transition: background 0.15s, color 0.15s;
  }
  .first-bar--on .vis-ico { color: var(--cs-purple, #3b2f8a); }
  .first-bar--visible:hover .vis-ico { background: rgba(59, 47, 138, 0.06); }
  .vis-ico svg { width: 18px; height: 12px; }

  /* PC·모바일 이미지 두 칸을 세로로 */
  .thumbs {
    flex-shrink: 0;
    align-self: flex-start;   /* 카드 상단 정렬 */
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

  /* CMS 공통 표준 삭제 아이콘 버튼(CmsDeleteButton .act-del 규격) — 투명 면, 호버는 옅은 레드 면 + 레드 아이콘 */
  .btn-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    min-width: 28px;
    flex-shrink: 0;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-light);
    cursor: pointer;
    align-self: flex-end;   /* 입력칸 아래 우측 */
    transition: background 0.1s, color 0.1s;
  }
  .btn-remove:hover { background: rgba(255, 53, 53, 0.08); color: var(--cs-red-badge); }

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
