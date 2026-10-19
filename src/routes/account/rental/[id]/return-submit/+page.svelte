<script lang="ts">
  /**
   * /account/rental/[id]/return-submit — 고객 반납 제출 화면 (Migration #722)
   * 반납 방식별 안내 알림 CTA(택배 [반납요청] · 무인함 [무인함 반납완료] · 퀵 [반납 진행중])의 착지 화면.
   * UI: return-method 화면과 같은 최소 헤더 패턴 · 체크 버튼 = front-uiux.md §17 · 업로드 = §15(영상은 반납 증빙 전용 확장)
   * Svelte 5 Runes 전용 — Svelte 4 문법 금지
   */
  import { supabase } from '$lib/services/supabase'
  import { sanitizeLockerInput, LOCKER_NUMBER_MAX, LOCKER_PASSWORD_MAX } from '$lib/utils/lockerFields'
  import {
    RETURN_CHECKLIST_ITEMS,
    RETURN_MEDIA_ITEMS,
    RETURN_MEDIA_MAX_PER_ITEM,
    RETURN_SUBMIT_RULES,
  } from '$lib/utils/returnNotice'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  const BUCKET = 'return-evidence'
  const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm'
  const IMAGE_MAX = 10 * 1024 * 1024
  const VIDEO_MAX = 100 * 1024 * 1024
  const MIME_OK = new Set(ACCEPT.split(','))

  interface Uploaded { path: string; kind: 'photo' | 'video'; previewUrl: string; name: string }

  const method = $derived(data.method)
  const rules = $derived(method ? RETURN_SUBMIT_RULES[method] : null)
  const mediaItems = $derived(method ? RETURN_MEDIA_ITEMS[method] : [])
  const reservationId = $derived(data.rental.id)

  let checked = $state<Record<string, boolean>>({})
  let uploads = $state<Record<string, Uploaded[]>>({})
  let uploadingCount = $state(0)
  let lockerNumber = $state('')
  let lockerPassword = $state('')
  let isSaving = $state(false)
  let errorMsg = $state<string | null>(null)
  let done = $state(false)

  const allChecked = $derived(RETURN_CHECKLIST_ITEMS.every((i) => checked[i.key]))
  const totalMedia = $derived(Object.values(uploads).reduce((n, list) => n + list.length, 0))
  const canConfirm = $derived.by(() => {
    if (!rules || isSaving || uploadingCount > 0) return false
    if (rules.checklist && !allChecked) return false
    if (rules.photosRequired && totalMedia === 0) return false
    if (rules.lockerInfo && (!lockerNumber.trim() || lockerPassword.trim().length < 4)) return false
    return true
  })

  function formatDate(dt: string | null): string {
    return dt ? dt.slice(0, 10) : '-'
  }

  const METHOD_TITLE: Record<string, string> = {
    courier: '택배 반납',
    quick: '퀵서비스 반납',
    locker: '무인함 반납',
  }

  // 사진은 가능하면 긴 변 2000px JPEG로 줄여 올린다(휴대폰 원본 용량·전송 시간 절감). HEIC 등 브라우저가 못 읽는 형식은 원본 그대로.
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

  async function onPick(itemKey: string, event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    errorMsg = null
    for (const file of files) {
      const current = uploads[itemKey] ?? []
      if (current.length >= RETURN_MEDIA_MAX_PER_ITEM) {
        errorMsg = `항목당 최대 ${RETURN_MEDIA_MAX_PER_ITEM}장까지 올릴 수 있어요.`
        break
      }
      if (!MIME_OK.has(file.type)) {
        errorMsg = 'JPEG, PNG, WebP, HEIC 사진 또는 MP4, MOV, WebM 영상만 올릴 수 있어요.'
        continue
      }
      const isVideo = file.type.startsWith('video/')
      if (file.size > (isVideo ? VIDEO_MAX : IMAGE_MAX)) {
        errorMsg = isVideo ? '영상은 파일당 100MB 이하여야 해요.' : '사진은 파일당 10MB 이하여야 해요.'
        continue
      }

      uploadingCount++
      try {
        const blob = await prepareFile(file)
        const contentType = blob.type || file.type
        const signRes = await fetch(`/api/account/rental/${reservationId}/return-submit/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_key: itemKey, content_type: contentType, size: blob.size }),
        })
        const sign = (await signRes.json().catch(() => ({}))) as { path?: string; token?: string; kind?: 'photo' | 'video'; error?: string }
        if (!signRes.ok || !sign.path || !sign.token) {
          errorMsg = sign.error ?? '업로드 준비에 실패했어요.'
          continue
        }
        const { error: upErr } = await supabase.storage.from(BUCKET).uploadToSignedUrl(sign.path, sign.token, blob, { contentType })
        if (upErr) {
          errorMsg = '파일을 올리지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.'
          continue
        }
        uploads[itemKey] = [
          ...(uploads[itemKey] ?? []),
          { path: sign.path, kind: sign.kind ?? (isVideo ? 'video' : 'photo'), previewUrl: URL.createObjectURL(blob), name: file.name },
        ]
      } catch {
        errorMsg = '파일을 올리는 중 오류가 발생했어요.'
      } finally {
        uploadingCount--
      }
    }
  }

  function removeUpload(itemKey: string, index: number): void {
    const list = uploads[itemKey] ?? []
    const target = list[index]
    if (target) URL.revokeObjectURL(target.previewUrl)
    uploads[itemKey] = list.filter((_, i) => i !== index)
  }

  async function submit(): Promise<void> {
    if (!canConfirm) return
    isSaving = true
    errorMsg = null
    try {
      const media = mediaItems.flatMap((item) =>
        (uploads[item.key] ?? []).map((u) => ({ item_key: item.key, path: u.path, kind: u.kind })),
      )
      const res = await fetch(`/api/account/rental/${reservationId}/return-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checklist: RETURN_CHECKLIST_ITEMS.filter((i) => checked[i.key]).map((i) => i.key),
          locker_number: lockerNumber.trim() || null,
          locker_password: lockerPassword.trim() || null,
          media,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        errorMsg = err.error ?? '제출 중 오류가 발생했어요.'
        return
      }
      done = true
      setTimeout(() => window.close(), 1500)
    } catch {
      errorMsg = '제출 중 오류가 발생했어요.'
    } finally {
      isSaving = false
    }
  }
</script>

<svelte:head>
  <title>반납 정보 등록 — 크레이지샷</title>
</svelte:head>

<div class="page-wrap">
  <header class="page-header">
    <button type="button" class="back-btn" onclick={() => window.close()} aria-label="창 닫기">‹</button>
    <span class="page-title">{method ? METHOD_TITLE[method] : '반납 정보 등록'}</span>
  </header>

  <div class="content">
    <div class="rental-card">
      {#if data.rental.product_name}<p class="product-name">{data.rental.product_name}</p>{/if}
      {#if data.rental.reservation_code}<p class="reservation-code">{data.rental.reservation_code}</p>{/if}
      <div class="date-row">
        <span class="date-label">반납 예정</span>
        <span class="date-value">{formatDate(data.rental.end_date)}{data.rental.return_time ? ` ${data.rental.return_time}` : ''}</span>
      </div>
    </div>

    {#if done}
      <div class="save-success" role="status">반납 정보가 등록됐어요. 잠시 후 창이 닫힙니다.</div>

    {:else if !method}
      <div class="notice-banner" role="status">
        <p class="notice-title">사진 등록이 필요하지 않은 반납이에요</p>
        <p class="notice-desc">방문 반납 등은 매장에서 직접 확인해요. 궁금한 점은 상담채팅으로 문의해 주세요.</p>
      </div>

    {:else if !data.canSubmit}
      <div class="notice-banner" role="status">
        <p class="notice-title">지금은 등록할 수 없는 상태예요</p>
        <p class="notice-desc">대여 중이거나 반납 접수 중인 예약만 등록할 수 있어요. 이미 반납이 완료됐다면 따로 하실 일은 없어요.</p>
      </div>

    {:else}
      {#if data.submittedAt}
        <div class="notice-banner" role="status">
          <p class="notice-title">이미 반납 정보를 등록하셨어요</p>
          <p class="notice-desc">사진 {data.mediaCount}장이 등록돼 있어요. 다시 등록하면 기존 내용이 새로 올린 내용으로 바뀌어요.</p>
        </div>
      {/if}

      {#if method === 'locker'}
        <div class="warn-banner" role="alert">
          <p class="warn-title">대여 종료 시간까지 입력이 없으면 지연 연체 요금이 발생할 수 있어요!</p>
          <p class="notice-desc">무인함에 장비를 넣은 뒤 사진과 무인함 번호·비밀번호를 꼭 입력해 주세요.</p>
        </div>
      {/if}

      {#if method === 'quick'}
        <div class="notice-banner">
          <p class="notice-title">퀵서비스로 반납을 진행 중이신가요?</p>
          <p class="notice-desc">대여 종료 시간은 매장 도착 기준이에요. 퀵 기사님께 장비를 인계하셨다면 아래 버튼으로 알려 주세요.</p>
        </div>
      {/if}

      {#if rules?.checklist}
        <div class="section">
          <p class="section-label">장비 확인 체크리스트</p>
          <div class="check-list">
            {#each RETURN_CHECKLIST_ITEMS as item (item.key)}
              <button
                type="button"
                class="check-row"
                onclick={() => (checked[item.key] = !checked[item.key])}
                aria-pressed={!!checked[item.key]}
              >
                <span class="checkbox-btn checkbox-btn-terms" class:checked={!!checked[item.key]}>
                  <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                    <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
                  </svg>
                </span>
                <span class="check-label">{item.label}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#each mediaItems as item (item.key)}
        <div class="section">
          <p class="section-label">{item.label}{rules?.photosRequired ? '' : ' (선택)'}</p>
          <div class="thumb-row">
            {#each uploads[item.key] ?? [] as up, i (up.path)}
              <div class="thumb">
                {#if up.kind === 'video'}
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <video src={up.previewUrl} muted playsinline></video>
                {:else}
                  <img src={up.previewUrl} alt={`${item.label} ${i + 1}`} />
                {/if}
                <button type="button" class="thumb-remove close-red" onclick={() => removeUpload(item.key, i)} aria-label="삭제">✕</button>
              </div>
            {/each}
            {#if (uploads[item.key] ?? []).length < RETURN_MEDIA_MAX_PER_ITEM}
              <label class="thumb add">
                <span>＋</span>
                <input type="file" accept={ACCEPT} multiple onchange={(e) => onPick(item.key, e)} />
              </label>
            {/if}
          </div>
        </div>
      {/each}

      {#if rules?.lockerInfo}
        <div class="section">
          <p class="section-label">무인함 정보</p>
          <label class="field">
            <span class="field-label">무인함 번호</span>
            <input
              class="cs-input"
              inputmode="numeric"
              maxlength={LOCKER_NUMBER_MAX}
              value={lockerNumber}
              oninput={(e) => { lockerNumber = sanitizeLockerInput(e.currentTarget.value); e.currentTarget.value = lockerNumber }}
              placeholder="예: 12"
            />
          </label>
          <label class="field">
            <span class="field-label">비밀번호</span>
            <input
              class="cs-input"
              inputmode="numeric"
              maxlength={LOCKER_PASSWORD_MAX}
              value={lockerPassword}
              oninput={(e) => { lockerPassword = sanitizeLockerInput(e.currentTarget.value); e.currentTarget.value = lockerPassword }}
              placeholder="숫자·특수문자 4~10자"
            />
          </label>
        </div>
      {/if}

      {#if uploadingCount > 0}<p class="hint" role="status">파일을 올리는 중이에요…</p>{/if}
      {#if errorMsg}<p class="save-error" role="alert">{errorMsg}</p>{/if}
    {/if}
  </div>

  {#if method === 'locker' && data.canSubmit && !done}
    <!-- 무인함 반납 시간 연장 요청 — 고객용 연장 기능이 없어 이 예약 컨텍스트의 크레이지챗으로 연결(플랜 기본값). 연체 요금은 종료 시간 기준으로 발생할 수 있다 -->
    <div class="extend-wrap">
      <a class="extend-link" href={`/chat?context=reservation&id=${reservationId}`} target="_blank" rel="noopener noreferrer">반납 시간 연장 요청 (크레이지챗)</a>
      <p class="hint">종료 시간까지 반납이 어려우면 먼저 채팅으로 연장을 요청해 주세요. 요청 없이 늦으면 연체 요금이 발생할 수 있어요.</p>
    </div>
  {/if}

  {#if method && data.canSubmit && !done}
    <div class="bottom-cta">
      <button type="button" class="btn-cta" onclick={submit} disabled={!canConfirm}>
        {#if isSaving}등록 중...{:else if method === 'quick'}반납 진행중{:else if method === 'locker'}무인함 반납완료{:else}확인{/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .page-wrap { min-height: 100dvh; background: var(--cs-lilac, #ECEBF4); display: flex; flex-direction: column; max-width: 480px; margin: 0 auto; padding-bottom: 100px; }
  .page-header { position: sticky; top: 0; z-index: 10; background: var(--cs-dark, #100B32); color: #fff; display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px; min-height: 56px; }
  .back-btn { background: none; border: none; color: #fff; font-size: 24px; line-height: 1; cursor: pointer; padding: 8px; min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md, 15px); transition: background 0.15s; }
  .back-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .page-title { font: 700 16px/1 'Noto Sans KR', sans-serif; color: #fff; }
  .content { flex: 1; display: flex; flex-direction: column; gap: 16px; padding: 16px; }

  .rental-card { background: #fff; border-radius: var(--radius-xl, 30px); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
  .product-name { font: 700 16px/1.3 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); margin: 0; }
  .reservation-code { font: 400 12px/1 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); margin: 0; }
  .date-row { display: flex; gap: 8px; align-items: center; }
  .date-label { font: 400 12px/1 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); white-space: nowrap; }
  .date-value { font: 700 13px/1 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); }

  .notice-banner { background: var(--cs-surface-gray, #f6f6f6); border-radius: var(--radius-xl, 30px); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
  .notice-title { font: 700 15px/1.3 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); margin: 0; }
  .notice-desc { font: 400 13px/1.6 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); margin: 0; }
  .warn-banner { background: var(--cs-red-xlight, #FFEDED); border-radius: var(--radius-xl, 30px); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
  .warn-title { font: 900 15px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-red-badge, #FF3535); margin: 0; }

  .section { display: flex; flex-direction: column; gap: 12px; }
  .section-label { font: 700 14px/1 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); margin: 0; padding: 0 4px; }

  .check-list { background: #fff; border-radius: var(--radius-xl, 30px); padding: 8px 12px; display: flex; flex-direction: column; }
  .check-row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 6px 8px; background: none; border: none; cursor: pointer; text-align: left; }
  .check-label { font: 400 14px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); }
  .checkbox-btn { flex-shrink: 0; display: inline-flex; }
  .checkbox-btn-terms { color: var(--cs-purple-op10, rgba(59, 47, 138, 0.1)); }
  .checkbox-btn-terms.checked { color: var(--cs-purple, #3B2F8A); }
  .checkbox-btn-terms svg { width: 22px; height: 15px; }
  @media (min-width: 768px) { .checkbox-btn-terms svg { width: 18px; height: 12px; } }

  .thumb-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumb { position: relative; width: 88px; height: 88px; border-radius: var(--radius-md, 15px); overflow: hidden; background: #fff; display: flex; align-items: center; justify-content: center; }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; }
  .thumb.add { cursor: pointer; font: 400 28px/1 'Noto Sans KR', sans-serif; color: var(--cs-purple, #3B2F8A); }
  .thumb.add input { display: none; }
  .thumb-remove { position: absolute; top: 4px; right: 4px; width: 28px; height: 28px; min-width: 28px; min-height: 28px; border: none; border-radius: 50%; background: rgba(16, 11, 50, 0.6); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; }
  .thumb-remove:hover { background: var(--cs-red-badge, #FF3535); }

  .field { display: flex; flex-direction: column; gap: 6px; }
  .field-label { font: 700 12px/1 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); padding: 0 4px; }
  .cs-input { background: #fff; border: none; border-radius: var(--radius-sm, 8px); padding: 12px 20px; min-height: 44px; font: 400 14px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); }
  .cs-input:focus { outline: 2px solid var(--cs-purple, #3B2F8A); outline-offset: -2px; }

  .hint { font: 400 13px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); margin: 0; padding: 0 4px; }
  .save-error { font: 400 13px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-error, #E53935); margin: 0; padding: 0 4px; }
  .save-success { background: rgba(46, 204, 113, 0.12); color: #1a8a4a; border-radius: var(--radius-md, 15px); padding: 14px 20px; font: 700 14px/1.4 'Noto Sans KR', sans-serif; }

  .bottom-cta { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; padding: 16px; background: linear-gradient(to top, var(--cs-lilac, #ECEBF4) 60%, transparent); box-sizing: border-box; }
  .extend-wrap { max-width: 480px; margin: 0 auto; padding: 0 var(--layout-mob-pad, 25px) 12px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .extend-link { display: inline-flex; align-items: center; min-height: 44px; color: var(--cs-purple, #3B2F8A); font: 700 14px/1 'Noto Sans KR', sans-serif; text-decoration: underline; }
  .btn-cta { width: 100%; background: var(--cs-red-badge, #FF3535); border: none; border-radius: var(--radius-xl, 30px); min-height: 52px; font: 700 16px/1 'Noto Sans KR', sans-serif; color: #fff; cursor: pointer; transition: background 0.15s; }
  .btn-cta:hover:not(:disabled) { background: var(--cs-red, #CF0000); }
  .btn-cta:disabled { background: #B0ABCC; cursor: not-allowed; }
</style>
