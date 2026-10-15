<script lang="ts">
  /**
   * /members "정기구독 이용안내" 영역 배경 사진 2장(상단·하단) 교체·초점 관리모달 (PC 전용 — front 관리모달 표준, front-uiux.md §9-2-A)
   * 저장: cms_settings.members_benefits_photos (upsert_product_page_setting RPC, Migration #715)
   * 업로드·삭제: 기존 /api/cms/members/hero-banner 엔드포인트 재사용(CMS 권한 확인 포함) — 같은 /members 화면의 배너 이미지 저장소.
   * 초점(x·y %)은 PC 가로 띠와 모바일 좁은 띠에 같은 값으로 적용된다(object-position) — 아래 두 미리보기가 실제 비율이다.
   */
  import { invalidateAll } from '$app/navigation'
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'
  import { validateUploadFileSize } from '$lib/utils/fileValidation'
  import {
    BENEFITS_DEFAULT_FOCUS,
    BENEFITS_DEFAULT_SRC,
    BENEFITS_PHOTOS_SETTING_KEY,
    compactBenefitsPhoto,
    type BenefitsPhoto,
    type BenefitsPhotoSlot,
    type BenefitsPhotosSetting,
  } from '$lib/utils/membersBenefitsPhotos'

  interface Props {
    initial: BenefitsPhotosSetting
    onclose: () => void
  }

  let { initial, onclose }: Props = $props()

  const SLOTS: { key: BenefitsPhotoSlot; label: string }[] = [
    { key: 'top', label: '상단 사진' },
    { key: 'bottom', label: '하단 사진' },
  ]
  const ACCEPT = 'image/png,image/jpeg,image/webp,image/heif,image/heic'
  const ALLOWED_TYPES = ACCEPT.split(',')

  // 슬롯별 편집 상태 — 항상 완전한 값(기본 사진이면 url·path 가 null, 초점은 기본값으로 채움)
  function toEditable(photo: BenefitsPhoto | null, slot: BenefitsPhotoSlot): BenefitsPhoto {
    return photo
      ? { ...photo }
      : { url: null, path: null, x: BENEFITS_DEFAULT_FOCUS[slot].x, y: BENEFITS_DEFAULT_FOCUS[slot].y }
  }

  // 이 모달은 열릴 때마다 부모의 {#if}로 새로 마운트되고 열려 있는 동안 initial 이 바뀌지 않는다(저장 성공 뒤에는 닫힌다)
  // — ui-mobile.md "$state(prop) 초기화 금지"의 허용 패턴 1(재마운트)에 해당. 편집 중인 값이 서버 재조회로 덮이지 않도록
  // $effect 동기화는 일부러 쓰지 않는다. 그래서 초기값은 마운트 시점 1회만 복사한다.
  // svelte-ignore state_referenced_locally
  const original: BenefitsPhotosSetting = { top: initial.top, bottom: initial.bottom }
  // svelte-ignore state_referenced_locally
  let photos = $state<Record<BenefitsPhotoSlot, BenefitsPhoto>>({
    top: toEditable(initial.top, 'top'),
    bottom: toEditable(initial.bottom, 'bottom'),
  })

  let uploading = $state<BenefitsPhotoSlot | null>(null)
  let isSaving = $state(false)
  let error = $state<string | null>(null)
  let saved = false
  const fileInputs: Record<BenefitsPhotoSlot, HTMLInputElement | undefined> = $state({ top: undefined, bottom: undefined })
  /** 이 모달에서 새로 올린 파일 경로 — 저장 없이 닫으면 정리한다 */
  const sessionUploads = new Set<string>()

  function previewSrc(slot: BenefitsPhotoSlot): string {
    return photos[slot].url ?? BENEFITS_DEFAULT_SRC[slot]
  }

  function dropFile(path: string | null) {
    if (!path) return
    sessionUploads.delete(path)
    fetch('/api/cms/members/hero-banner', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {/* 스토리지 정리 실패는 화면 동작에 영향 없음 */})
  }

  async function onFileChange(slot: BenefitsPhotoSlot, e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) {
      error = 'PNG, JPEG, WebP, HEIF 파일만 업로드할 수 있어요.'
      return
    }
    const size = validateUploadFileSize(file)
    if (!size.ok) {
      error = size.error ?? '파일이 너무 큽니다.'
      return
    }

    uploading = slot
    error = null
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/cms/members/hero-banner', { method: 'POST', body: form })
      if (!res.ok) {
        error = (await res.text().catch(() => '')) || '업로드에 실패했습니다.'
        return
      }
      const { url, path } = (await res.json()) as { url: string; path: string }
      // 같은 모달에서 이미 올렸던 사진을 다시 교체하면 이전 파일은 바로 정리(저장 전 임시 파일)
      if (photos[slot].path && sessionUploads.has(photos[slot].path as string)) dropFile(photos[slot].path)
      sessionUploads.add(path)
      photos[slot] = { ...photos[slot], url, path }
    } catch {
      error = '네트워크 오류로 업로드하지 못했습니다.'
    } finally {
      uploading = null
    }
  }

  /** 업로드한 사진을 빼고 기본 사진으로 되돌린다(초점은 유지) */
  function resetToDefault(slot: BenefitsPhotoSlot) {
    const prev = photos[slot].path
    if (prev && sessionUploads.has(prev)) dropFile(prev)
    photos[slot] = { ...photos[slot], url: null, path: null }
  }

  function resetFocus(slot: BenefitsPhotoSlot) {
    photos[slot] = { ...photos[slot], x: BENEFITS_DEFAULT_FOCUS[slot].x, y: BENEFITS_DEFAULT_FOCUS[slot].y }
  }

  // 저장·업로드가 진행 중이면 닫지 않는다 — 저장 응답 전에 닫으면 방금 올린 파일이 "저장 안 됨"으로 오인돼 삭제되고
  // (설정은 그 파일 주소로 저장되어 /members 전체에 깨진 사진), 업로드 중에 닫으면 응답이 늦게 와 임시 파일이 고아로 남는다(sp3 M-1·m-1).
  const busy = $derived(isSaving || uploading !== null)

  function cleanupAndClose() {
    if (busy) return
    if (!saved) {
      for (const path of [...sessionUploads]) dropFile(path)
    }
    onclose()
  }

  async function save() {
    isSaving = true
    error = null
    try {
      const value: BenefitsPhotosSetting = {
        top: compactBenefitsPhoto(photos.top, 'top'),
        bottom: compactBenefitsPhoto(photos.bottom, 'bottom'),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase.rpc as any)('upsert_product_page_setting', {
        p_key: BENEFITS_PHOTOS_SETTING_KEY,
        p_value: value,
      })
      if (err) {
        error = err.message
        return
      }
      saved = true
      // 저장이 끝난 뒤, 더 이상 쓰지 않는 이전 업로드 파일을 정리한다(저장 실패 시에는 건드리지 않음)
      for (const slot of ['top', 'bottom'] as const) {
        const before = original[slot]?.path ?? null
        const after = value[slot]?.path ?? null
        if (before && before !== after) dropFile(before)
      }
      csToast.success('배경 사진을 저장했어요.')
      await invalidateAll()
      onclose()
    } catch (e) {
      error = e instanceof Error ? e.message : '저장하지 못했습니다.'
    } finally {
      isSaving = false
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={cleanupAndClose} role="presentation"></div>

<aside class="modal-panel" role="dialog" aria-modal="true" aria-label="이용안내 영역 배경 사진 관리">
  <div class="modal-header">
    <span class="modal-title">이용안내 배경 사진 관리</span>
    <button class="modal-close" onclick={cleanupAndClose} disabled={busy} aria-label="닫기">✕</button>
  </div>

  <div class="modal-body">
    <p class="spec-note">
      PC와 모바일에 같은 사진이 쓰입니다. 아래 두 미리보기(PC 가로 띠 · 모바일 띠)가 실제 비율이며,
      <strong>초점 위치</strong>가 두 화면 모두에서 가장 잘 보이는 지점이 됩니다.
    </p>

    {#each SLOTS as slot, i (slot.key)}
      {#if i > 0}<div class="divider"></div>{/if}
      <div class="section">
        <p class="section-label">{slot.label}
          <span class="hint">{photos[slot.key].url ? '업로드한 사진' : '기본 사진'}</span>
        </p>

        <div class="preview-group">
          <div class="preview-item">
            <span class="preview-tag">PC</span>
            <div class="preview-frame preview-pc">
              <img
                src={previewSrc(slot.key)}
                alt={`${slot.label} PC 미리보기`}
                style:object-position={`${photos[slot.key].x}% ${photos[slot.key].y}%`}
              />
            </div>
          </div>
          <div class="preview-item">
            <span class="preview-tag">모바일</span>
            <div class="preview-frame preview-mobile">
              <img
                src={previewSrc(slot.key)}
                alt={`${slot.label} 모바일 미리보기`}
                style:object-position={`${photos[slot.key].x}% ${photos[slot.key].y}%`}
              />
            </div>
          </div>
        </div>

        <div class="btn-row">
          <button class="upload-btn" onclick={() => fileInputs[slot.key]?.click()} disabled={uploading !== null || isSaving}>
            {#if uploading === slot.key}업로드 중…{:else if photos[slot.key].url}사진 교체{:else}+ 사진 교체{/if}
          </button>
          {#if photos[slot.key].url}
            <button class="btn-text" onclick={() => resetToDefault(slot.key)} disabled={uploading !== null || isSaving}>기본 사진으로</button>
          {/if}
          <input
            bind:this={fileInputs[slot.key]}
            type="file"
            accept={ACCEPT}
            class="hidden-input"
            onchange={(e) => onFileChange(slot.key, e)}
          />
        </div>
        <p class="hint">PNG · JPEG · WebP · HEIF, 10MB 이하</p>

        <div class="focus-row">
          <label class="focus-label" for={`focus-x-${slot.key}`}>가로 위치 <span class="focus-val">{photos[slot.key].x}%</span></label>
          <input
            id={`focus-x-${slot.key}`}
            class="focus-range"
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={photos[slot.key].x}
          />
        </div>
        <div class="focus-row">
          <label class="focus-label" for={`focus-y-${slot.key}`}>세로 위치 <span class="focus-val">{photos[slot.key].y}%</span></label>
          <input
            id={`focus-y-${slot.key}`}
            class="focus-range"
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={photos[slot.key].y}
          />
        </div>
        <button class="btn-text btn-focus-reset" onclick={() => resetFocus(slot.key)} disabled={isSaving}>초점 기본값으로</button>
      </div>
    {/each}

    {#if error}
      <p class="save-error" role="alert">{error}</p>
    {/if}
  </div>

  <div class="modal-footer">
    <button class="btn-cancel" onclick={cleanupAndClose} disabled={busy}>취소</button>
    <button class="btn-save" onclick={save} disabled={isSaving || uploading !== null}>
      {isSaving ? '저장 중…' : '저장'}
    </button>
  </div>
</aside>

<style>
  /* ── 패널·헤더·푸터: front 관리모달 표준(front-uiux.md §9-2-A, MembersHeroBannerModal 과 동일 값) ── */
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
  .modal-close:disabled { opacity: 0.4; cursor: default; }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .divider { height: 1px; background: var(--cs-lilac); margin: 4px 0; flex-shrink: 0; }

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

  .hint {
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-light);
    margin: 0;
  }

  .spec-note {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    line-height: 1.6;
    margin: 0;
  }
  .spec-note strong { font-weight: 700; color: var(--cs-text); }

  /* ── 미리보기: 실제 화면 비율(PC 1240:400 가로 띠 / 모바일 390:200 띠) ── */
  .preview-group { display: flex; flex-direction: column; gap: 8px; }
  .preview-item { display: flex; flex-direction: column; gap: 4px; }
  .preview-tag {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .preview-frame {
    width: 100%;
    overflow: hidden;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
  }
  .preview-pc { aspect-ratio: 1240 / 400; }
  .preview-mobile { aspect-ratio: 390 / 200; }
  .preview-frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .btn-row { display: flex; align-items: center; gap: 12px; }

  .upload-btn {
    height: 40px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
  }
  .upload-btn:hover { opacity: 0.85; }
  .upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .hidden-input { display: none; }

  /* 텍스트형 보조 버튼 — 배경·보더 없이 색만 바뀜(호버는 색만) */
  .btn-text {
    background: none;
    border: none;
    padding: 0 4px;
    min-height: 32px;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    cursor: pointer;
    align-self: flex-start;
  }
  .btn-text:hover { color: var(--cs-red-badge); }
  .btn-text:disabled { opacity: 0.5; cursor: default; }
  .btn-focus-reset { margin-top: -4px; }

  /* ── 초점 슬라이더 ── */
  .focus-row { display: flex; flex-direction: column; gap: 4px; }
  .focus-label {
    display: flex;
    justify-content: space-between;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .focus-val { font-weight: 700; color: var(--cs-purple); }
  .focus-range {
    width: 100%;
    min-height: 32px;
    accent-color: var(--cs-purple);
    cursor: pointer;
  }

  .save-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    margin: 0;
  }

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
  .btn-cancel:disabled { opacity: 0.5; }

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
