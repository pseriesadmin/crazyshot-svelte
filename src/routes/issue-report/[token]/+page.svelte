<script lang="ts">
  /**
   * /issue-report/[token] — 고객 이상·파손·분실 증빙 등록 폼 (3단계, Migration #728)
   * 로그인 없이 토큰 링크로 접근. UI: return-submit 화면과 같은 최소 헤더 패턴 · 유형 선택 = 콤보 버튼형 토글(front-uiux.md §16)
   * 업로드: 사진·영상(10MB / 100MB), 비공개 버킷 서명 URL로 직접 업로드.
   * Svelte 5 Runes 전용 — Svelte 4 문법 금지
   */
  import { supabase } from '$lib/services/supabase'
  import { INSPECTION_DETAIL_MAX, INSPECTION_MEDIA_MAX, PRIOR_ISSUE_KINDS } from '$lib/utils/inspection'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const token = $derived(data.token)
  const BUCKET = 'return-evidence'
  const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm'
  const IMAGE_MAX = 10 * 1024 * 1024
  const VIDEO_MAX = 100 * 1024 * 1024
  const MIME_OK = new Set(ACCEPT.split(','))

  interface Uploaded { path: string; kind: 'photo' | 'video'; previewUrl: string; name: string }

  let types = $state<string[]>([])
  let detail = $state('')
  let uploads = $state<Uploaded[]>([])
  let uploadingCount = $state(0)
  let isSaving = $state(false)
  let errorMsg = $state<string | null>(null)
  let done = $state(false)

  // 이전에 제출한 유형·내용을 처음 한 번만 채운다(링크를 다시 연 경우)
  let seeded = $state(false)
  $effect(() => {
    if (seeded) return
    seeded = true
    types = [...data.prevTypes]
    detail = data.prevDetail
  })

  const canSubmit = $derived(!isSaving && uploadingCount === 0 && types.length > 0)

  function toggleType(key: string): void {
    types = types.includes(key) ? types.filter((k) => k !== key) : [...types, key]
    errorMsg = null
  }

  // 사진은 가능하면 긴 변 2000px JPEG로 줄여 올린다. HEIC 등 브라우저가 못 읽는 형식은 원본 그대로.
  async function prepareFile(file: File): Promise<Blob> {
    if (!file.type.startsWith('image/') || file.type === 'image/heic' || file.type === 'image/heif') return file
    try {
      const bmp = await createImageBitmap(file)
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scale)
      canvas.height = Math.round(bmp.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      return blob && blob.size < file.size ? blob : file
    } catch {
      return file
    }
  }

  async function onPick(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    errorMsg = null
    for (const file of files) {
      if (uploads.length >= INSPECTION_MEDIA_MAX) { errorMsg = `사진·영상은 최대 ${INSPECTION_MEDIA_MAX}개까지 올릴 수 있어요.`; break }
      if (!MIME_OK.has(file.type)) { errorMsg = 'JPEG, PNG, WebP, HEIC 사진 또는 MP4, MOV, WebM 영상만 올릴 수 있어요.'; continue }
      const isVideo = file.type.startsWith('video/')
      if (file.size > (isVideo ? VIDEO_MAX : IMAGE_MAX)) { errorMsg = isVideo ? '영상은 파일당 100MB 이하여야 해요.' : '사진은 파일당 10MB 이하여야 해요.'; continue }

      uploadingCount++
      try {
        const blob = await prepareFile(file)
        const contentType = blob.type || file.type
        const signRes = await fetch(`/api/issue-report/${token}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_type: contentType, size: blob.size }),
        })
        const sign = (await signRes.json().catch(() => ({}))) as { path?: string; token?: string; kind?: 'photo' | 'video'; error?: string }
        if (!signRes.ok || !sign.path || !sign.token) { errorMsg = sign.error ?? '업로드 준비에 실패했어요.'; continue }
        const { error: upErr } = await supabase.storage.from(BUCKET).uploadToSignedUrl(sign.path, sign.token, blob, { contentType })
        if (upErr) { errorMsg = '파일을 올리지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.'; continue }
        uploads = [...uploads, { path: sign.path, kind: sign.kind ?? (isVideo ? 'video' : 'photo'), previewUrl: URL.createObjectURL(blob), name: file.name }]
      } catch {
        errorMsg = '파일을 올리는 중 오류가 발생했어요.'
      } finally {
        uploadingCount--
      }
    }
  }

  function removeUpload(index: number): void {
    const t = uploads[index]
    if (t) URL.revokeObjectURL(t.previewUrl)
    uploads = uploads.filter((_, i) => i !== index)
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return
    isSaving = true
    errorMsg = null
    try {
      const res = await fetch(`/api/issue-report/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types, detail, media: uploads.map((u) => ({ path: u.path, kind: u.kind })) }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        errorMsg = err.error ?? '제출 중 오류가 발생했어요.'
        return
      }
      done = true
    } catch {
      errorMsg = '제출 중 오류가 발생했어요.'
    } finally {
      isSaving = false
    }
  }
</script>

<svelte:head>
  <title>이상·파손 증빙 등록 — 크레이지샷</title>
</svelte:head>

<div class="page-wrap">
  <header class="page-header">
    <span class="page-title">이상·파손·분실 증빙 등록</span>
  </header>

  <div class="content">
    <div class="rental-card">
      {#if data.productName}<p class="product-name">{data.productName}</p>{/if}
      {#if data.reservationCode}<p class="reservation-code">{data.reservationCode}</p>{/if}
    </div>

    {#if data.expired}
      <div class="notice-banner" role="status">
        <p class="notice-title">만료되었거나 취소된 요청이에요</p>
        <p class="notice-desc">증빙 등록이 필요하면 상담채팅으로 문의해 주세요.</p>
      </div>

    {:else if done}
      <div class="save-success" role="status">증빙이 등록됐어요. 담당자가 확인 후 연락드릴게요. 필요하면 이 링크에서 다시 올릴 수 있어요.</div>

    {:else}
      {#if data.submitted}
        <div class="notice-banner" role="status">
          <p class="notice-title">이미 증빙을 등록하셨어요</p>
          <p class="notice-desc">다시 등록하면 기존 내용이 새로 올린 내용으로 바뀌어요. 사진·영상은 다시 올려 주세요.</p>
        </div>
      {/if}

      <div class="section">
        <p class="section-label">어떤 문제인가요? (복수 선택)</p>
        <div class="combo-group" role="group" aria-label="이상 유형">
          {#each PRIOR_ISSUE_KINDS as k (k.key)}
            <button type="button" class="combo-btn" class:selected={types.includes(k.key)} aria-pressed={types.includes(k.key)} onclick={() => toggleType(k.key)}>
              <span class="combo-label">{k.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="section">
        <p class="section-label">상세 내용</p>
        <textarea class="cs-input" rows="4" maxlength={INSPECTION_DETAIL_MAX} placeholder="언제, 어디서, 어떤 문제가 있었는지 알려 주세요" bind:value={detail}></textarea>
      </div>

      <div class="section">
        <p class="section-label">사진·영상 (선택, 최대 {INSPECTION_MEDIA_MAX}개)</p>
        <div class="thumb-row">
          {#each uploads as up, i (up.path)}
            <div class="thumb">
              {#if up.kind === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={up.previewUrl} muted playsinline></video>
              {:else}
                <img src={up.previewUrl} alt={up.name} />
              {/if}
              <button type="button" class="thumb-remove" onclick={() => removeUpload(i)} aria-label="삭제">✕</button>
            </div>
          {/each}
          {#if uploads.length < INSPECTION_MEDIA_MAX}
            <label class="thumb add"><span>＋</span><input type="file" accept={ACCEPT} multiple onchange={onPick} /></label>
          {/if}
        </div>
      </div>

      {#if uploadingCount > 0}<p class="hint" role="status">파일을 올리는 중이에요…</p>{/if}
      {#if errorMsg}<p class="save-error" role="alert">{errorMsg}</p>{/if}
    {/if}
  </div>

  {#if !data.expired && !done}
    <div class="bottom-cta">
      <button type="button" class="btn-cta" onclick={submit} disabled={!canSubmit}>{isSaving ? '등록 중...' : '증빙 등록'}</button>
    </div>
  {/if}
</div>

<style>
  .page-wrap { min-height: 100dvh; background: var(--cs-lilac, #ECEBF4); display: flex; flex-direction: column; max-width: 480px; margin: 0 auto; padding-bottom: 100px; }
  .page-header { position: sticky; top: 0; z-index: 10; background: var(--cs-dark, #100B32); color: #fff; display: flex; align-items: center; padding: 0 16px; height: 56px; min-height: 56px; }
  .page-title { font: 700 16px/1 'Noto Sans KR', sans-serif; color: #fff; }
  .content { flex: 1; display: flex; flex-direction: column; gap: 16px; padding: 16px; }

  .rental-card { background: #fff; border-radius: var(--radius-xl, 30px); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
  .product-name { font: 700 16px/1.3 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); margin: 0; }
  .reservation-code { font: 400 12px/1 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); margin: 0; }

  .notice-banner { background: var(--cs-surface-gray, #f6f6f6); border-radius: var(--radius-xl, 30px); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
  .notice-title { font: 700 15px/1.3 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); margin: 0; }
  .notice-desc { font: 400 13px/1.6 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); margin: 0; }

  .section { display: flex; flex-direction: column; gap: 12px; }
  .section-label { font: 700 14px/1 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); margin: 0; padding: 0 4px; }

  .combo-group { display: flex; flex-wrap: wrap; gap: 6px; }
  .combo-btn { display: flex; align-items: center; padding: 9px 16px; border: 1.5px solid #DCDCDC; border-radius: var(--radius-xl, 30px); background: #fff; cursor: pointer; transition: border-color 0.15s, background 0.15s; min-height: 44px; }
  .combo-btn.selected { background: var(--cs-purple, #3B2F8A); border-color: var(--cs-purple, #3B2F8A); }
  .combo-btn:hover:not(.selected) { border-color: var(--cs-purple, #3B2F8A); background: rgba(59, 47, 138, 0.04); }
  .combo-label { font: 700 13px/1 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); }
  .combo-btn.selected .combo-label { color: #fff; }

  .cs-input { width: 100%; box-sizing: border-box; background: #fff; border: none; border-radius: var(--radius-sm, 8px); padding: 12px 20px; font: 400 14px/1.5 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); resize: vertical; }
  .cs-input:focus { outline: 2px solid var(--cs-purple, #3B2F8A); outline-offset: -2px; }

  .thumb-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumb { position: relative; width: 88px; height: 88px; border-radius: var(--radius-md, 15px); overflow: hidden; background: #fff; display: flex; align-items: center; justify-content: center; }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; }
  .thumb.add { cursor: pointer; font: 400 28px/1 'Noto Sans KR', sans-serif; color: var(--cs-purple, #3B2F8A); }
  .thumb.add input { display: none; }
  .thumb-remove { position: absolute; top: 4px; right: 4px; width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(16, 11, 50, 0.6); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; }
  .thumb-remove:hover { background: var(--cs-red-badge, #FF3535); }

  .hint { font: 400 13px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); margin: 0; padding: 0 4px; }
  .save-error { font: 400 13px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-error, #E53935); margin: 0; padding: 0 4px; }
  .save-success { background: rgba(46, 204, 113, 0.12); color: #1a8a4a; border-radius: var(--radius-md, 15px); padding: 14px 20px; font: 700 14px/1.5 'Noto Sans KR', sans-serif; }

  .bottom-cta { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; padding: 16px; background: linear-gradient(to top, var(--cs-lilac, #ECEBF4) 60%, transparent); box-sizing: border-box; }
  .btn-cta { width: 100%; background: var(--cs-red-badge, #FF3535); border: none; border-radius: var(--radius-xl, 30px); min-height: 52px; font: 700 16px/1 'Noto Sans KR', sans-serif; color: #fff; cursor: pointer; transition: background 0.15s; }
  .btn-cta:hover:not(:disabled) { background: var(--cs-red, #CF0000); }
  .btn-cta:disabled { background: #B0ABCC; cursor: not-allowed; }
</style>
