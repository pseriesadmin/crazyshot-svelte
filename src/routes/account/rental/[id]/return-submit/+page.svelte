<script lang="ts">
  /**
   * /account/rental/[id]/return-submit — 고객 반납 제출 화면 (Migration #722)
   * 반납 방식별 안내 알림 CTA(택배 [반납요청] · 무인함 [무인함 반납완료] · 퀵 [반납 진행중])의 착지 화면.
   * UI: return-method 화면과 같은 최소 헤더 패턴 · 체크 버튼 = front-uiux.md §17 · 업로드 = §15(영상은 반납 증빙 전용 확장)
   * 2026-10-22: 카드 슬롯 5장(소개 → 1단계 → 2단계 → 3단계 이용 평가 → 완료) + 반납등록 미션 포인트(Migration #739). 제출은 3단계에서 한 번만 POST.
   * Svelte 5 Runes 전용 — Svelte 4 문법 금지
   */
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { fly } from 'svelte/transition'
  import { onMount } from 'svelte'
  import { supabase } from '$lib/services/supabase'
  import LoadingIndicator from '$lib/components/common/LoadingIndicator.svelte'
  import ReturnStepFinger from '$lib/components/account/ReturnStepFinger.svelte'
  import { sanitizeLockerInput, LOCKER_NUMBER_MAX, LOCKER_PASSWORD_MAX } from '$lib/utils/lockerFields'
  import {
    RETURN_MEDIA_ITEMS,
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
  const mediaItems = $derived(method === 'courier' ? data.courierPhotoItems : method ? RETURN_MEDIA_ITEMS[method] : [])
  const reservationId = $derived(data.rental.id)
  // 소개 화면 배경 폴라로이드 — 상품 이미지가 적으면 같은 사진을 돌려 써서 5장을 채운다
  const polaroids = $derived(data.productImages.length ? Array.from({ length: 6 }, (_, i) => data.productImages[i % data.productImages.length]) : [])
  // 폴라로이드 배치 — 화면을 열 때마다 기준 자리(배경을 덮는 6곳)에서 위치·기울기·겹침 순서가 조금씩 무작위로 달라진다.
  // 서버 렌더와 어긋나지 않도록 브라우저에서 한 번만 정한다(그 전에는 그리지 않음).
  const POLAROID_SLOTS = [
    { side: 'left', x: -70, y: 30, rot: -10 },
    { side: 'right', x: -80, y: 190, rot: 9 },
    { side: 'left', x: -50, y: 390, rot: 6 },
    { side: 'right', x: -70, y: 560, rot: -8 },
    { side: 'left', x: -40, y: 690, rot: 7 },
    { side: 'left', x: 10, y: 250, rot: -3 },
  ] as const
  let polaroidStyles = $state<string[]>([])
  onMount(() => {
    const rnd = (n: number) => (Math.random() * 2 - 1) * n
    const order = POLAROID_SLOTS.map((_, i) => i).sort(() => Math.random() - 0.5)
    polaroidStyles = POLAROID_SLOTS.map((sl, i) => {
      const x = Math.round(sl.x + rnd(36))
      const y = Math.round(sl.y + rnd(40))
      const rot = (sl.rot + rnd(7)).toFixed(1)
      return `${sl.side}: ${x}px; top: ${y}px; transform: rotate(${rot}deg); z-index: ${order[i]};`
    })
  })

  let checked = $state<Record<string, boolean>>({})
  let uploads = $state<Record<string, Uploaded[]>>({})
  let uploadingCount = $state(0)
  let lockerNumber = $state('')
  let lockerPassword = $state('')
  let isSaving = $state(false)
  let errorMsg = $state<string | null>(null)

  // ── 카드 슬롯 단계(2026-10-22) — 소개 → 1(사진/인계 확인) → 2(체크리스트/무인함 정보/반납 안내) → 3(이용 평가) → 완료
  type Step = 'intro' | 1 | 2 | 3 | 'done'
  let step = $state<Step>('intro')
  let feedback = $state('')
  let rating = $state(0) // 이용 평가 점수 1~5(0 = 선택 안 함)
  // 점수 아이콘은 탭뿐 아니라 터치·마우스 드래그로도 고른다 — 손가락이 닿은/지나간 위치의 점수로 바뀐다
  let ratingRowEl = $state<HTMLDivElement | null>(null)
  let ratingDrag = { active: false, moved: false, prev: 0 }
  function ratingFromX(x: number): number {
    const btns = ratingRowEl?.querySelectorAll<HTMLElement>('.rating-btn')
    if (!btns || btns.length === 0) return 0
    for (let i = 0; i < btns.length; i++) {
      if (x < btns[i].getBoundingClientRect().right + 4) return i + 1
    }
    return btns.length
  }
  function setRating(n: number): void {
    if (n === rating) return
    rating = n
    popId++
  }
  function onRatingDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    try { ratingRowEl?.setPointerCapture(e.pointerId) } catch { /* 캡처 실패해도 선택은 계속 */ }
    ratingDrag = { active: true, moved: false, prev: rating }
    setRating(ratingFromX(e.clientX))
  }
  function onRatingMove(e: PointerEvent): void {
    if (!ratingDrag.active) return
    const n = ratingFromX(e.clientX)
    if (n !== rating) ratingDrag.moved = true
    setRating(n)
  }
  function onRatingUp(e: PointerEvent): void {
    if (!ratingDrag.active) return
    ratingDrag.active = false
    try { if (ratingRowEl?.hasPointerCapture(e.pointerId)) ratingRowEl.releasePointerCapture(e.pointerId) } catch { /* 이미 해제됨 */ }
    // 움직임 없이 이미 선택돼 있던 점수를 다시 누르면 선택 해제(기존 동작 유지)
    if (!ratingDrag.moved && ratingDrag.prev !== 0 && ratingDrag.prev === rating && e.type === 'pointerup') {
      rating = 0
      popId++
    }
  }
  // 완료 화면 하트 폭죽 — 손 이미지 중심에서 사방으로 불규칙하게 퍼진다(방향·거리·크기·회전·지연 모두 무작위, 완료 화면에 들어올 때마다 새로 정함)
  let hearts = $state<{ dx: number; dy: number; s: number; r: number; d: number }[]>([])
  $effect(() => {
    if (step !== 'done') return
    hearts = Array.from({ length: 18 }, () => {
      const ang = Math.random() * Math.PI * 2
      const dist = 90 + Math.random() * 170
      return {
        dx: Math.round(Math.cos(ang) * dist * 1.1),
        dy: Math.round(Math.sin(ang) * dist),
        s: +(0.45 + Math.random() * 0.75).toFixed(2),
        r: Math.round((Math.random() * 2 - 1) * 50),
        d: Math.round(Math.random() * 900),
      }
    })
  })
  let popId = $state(0) // 점수를 고를 때마다 +1 — 선택된 아이콘의 버블·바운스 모션을 다시 재생하는 키
  let handover = $state(false) // 퀵: 기사님께 장비를 인계했는지 확인(1단계 필수)
  const FEEDBACK_MAX = 100 // 서버 returnSubmission.ts RETURN_FEEDBACK_MAX·DB CHECK 와 같은 값
  const missionPoints = $derived(data.missionPoints)
  const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const slideMs = reduceMotion ? 0 : 260

  const checklistItems = $derived(data.checklistItems)
  const allChecked = $derived(checklistItems.every((i) => checked[i.key]))
  // 사진이 필수인 방식은 화면에 나온 사진 항목을 모두 채워야 한다(항목마다 1장 이상)
  const allPhotosFilled = $derived(mediaItems.every((i) => (uploads[i.key] ?? []).length > 0))
  // 단계별 [다음] 활성 조건 — 서버 검증(validateReturnSubmit)과 같은 요건을 화면에서 먼저 안내
  const canNext1 = $derived.by(() => {
    if (!rules || uploadingCount > 0) return false
    if (method === 'quick') return handover
    return !rules.photosRequired || allPhotosFilled
  })
  const canNext2 = $derived.by(() => {
    if (!rules) return false
    if (rules.checklist) return allChecked
    if (rules.lockerInfo) return !!lockerNumber.trim() && lockerPassword.trim().length >= 4
    return true
  })
  const STEP_TITLE: Record<1 | 2 | 3, string> = { 1: '사진 등록', 2: '', 3: '이용 평가' }
  const step2Title = $derived(method === 'courier' ? '반납상품 체크리스트' : method === 'locker' ? '무인함 정보' : '반납 안내 확인')
  const step1Title = $derived(method === 'quick' ? '인계 확인' : STEP_TITLE[1])

  function goNext(): void {
    errorMsg = null
    if (step === 'intro') step = 1
    else if (step === 1 && canNext1) step = 2
    else if (step === 2 && canNext2) step = 3
  }
  // PC 모바일-해상도 모달(ReturnSubmitModal)에 iframe 으로 열렸는지 — 닫기·이동은 부모에게 메시지로 요청한다
  const embedded = $derived($page.url.searchParams.get('modal') === '1')
  function postToParent(action: 'close' | 'goto', href?: string): void {
    window.parent.postMessage({ type: 'cs-return-submit', action, href }, window.location.origin)
  }
  function goPoints(): void {
    const href = window.matchMedia('(min-width: 1024px)').matches ? '/account?tab=point' : '/account/profile?tab=point'
    if (embedded) postToParent('goto', href)
    else goto(href)
  }

  function goBack(): void {
    errorMsg = null
    if (step === 1) step = 'intro'
    else if (step === 2) step = 1
    else if (step === 3) step = 2
    else if (embedded) postToParent('close')
    else window.close()
  }

  const canConfirm = $derived.by(() => {
    if (!rules || isSaving || uploadingCount > 0) return false
    if (method === 'quick' && !handover) return false
    if (rules.checklist && !allChecked) return false
    if (rules.photosRequired && !allPhotosFilled) return false
    if (rules.lockerInfo && (!lockerNumber.trim() || lockerPassword.trim().length < 4)) return false
    return true
  })

  function formatDate(dt: string | null): string {
    return dt ? dt.slice(0, 10) : '-'
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
      // 여러 장을 한 번에 고르면 누른 칸부터 시작해 비어 있는 다음 칸에 차례로 채운다(항목마다 1장)
      const order = [itemKey, ...mediaItems.map((i) => i.key).filter((k) => k !== itemKey)]
      const targetKey = order.find((k) => (uploads[k] ?? []).length < 1)
      if (!targetKey) break // 빈 칸이 없으면 남는 파일은 조용히 무시(안내 문구 없음)
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
          body: JSON.stringify({ item_key: targetKey, content_type: contentType, size: blob.size }),
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
        uploads[targetKey] = [
          ...(uploads[targetKey] ?? []),
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
          checklist: checklistItems.filter((i) => checked[i.key]).map((i) => i.key),
          locker_number: lockerNumber.trim() || null,
          locker_password: lockerPassword.trim() || null,
          feedback: feedback.trim() || null,
          rating: rating || null,
          media,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        errorMsg = err.error ?? '제출 중 오류가 발생했어요.'
        return
      }
      step = 'done'
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
    <button type="button" class="back-btn" onclick={goBack} aria-label={step === 'intro' || step === 'done' ? '창 닫기' : '이전 단계'}>‹</button>
    <span class="page-title">반납정보 등록하기</span> <!-- 2026-10-22 Stephen 지시: 방식별 제목(택배·퀵서비스·무인함 반납) → 공통 제목 -->
  </header>

  <LoadingIndicator loading={uploadingCount > 0} label="사진을 올리는 중" />

  {#if polaroids.length > 0}
    <div class="polaroid-bg" class:dim={step !== 'intro'} aria-hidden="true">
      {#each polaroids as pol, i (i)}
        {#if polaroidStyles[i]}<span class="polaroid" style={polaroidStyles[i]}><img src={pol} alt="" loading="lazy" /></span>{/if}
      {/each}
    </div>
  {/if}

  <div class="content">
    {#if !method}
      <div class="rental-card">
        {#if data.rental.product_name}<p class="product-name">{data.rental.product_name}</p>{/if}
        {#if data.rental.reservation_code}<p class="reservation-code">{data.rental.reservation_code}</p>{/if}
      </div>
      <div class="notice-banner" role="status">
        <p class="notice-title">사진 등록이 필요하지 않은 반납이에요</p>
        <p class="notice-desc">방문 반납 등은 매장에서 직접 확인해요. 궁금한 점은 상담채팅으로 문의해 주세요.</p>
      </div>

    {:else if !data.canSubmit}
      <div class="rental-card">
        {#if data.rental.product_name}<p class="product-name">{data.rental.product_name}</p>{/if}
        {#if data.rental.reservation_code}<p class="reservation-code">{data.rental.reservation_code}</p>{/if}
      </div>
      <div class="notice-banner" role="status">
        <p class="notice-title">지금은 등록할 수 없는 상태예요</p>
        <p class="notice-desc">대여 중이거나 반납 접수 중인 예약만 등록할 수 있어요. 이미 반납이 완료됐다면 따로 하실 일은 없어요.</p>
      </div>

    {:else}
      {#key step}
        <div class="slot-card" class:intro={step === 'intro'} class:done={step === 'done'} in:fly={{ x: 48, duration: slideMs, opacity: 0 }}>
          {#if step === 'intro'}
            <!-- 소개 카드 — 상품 정보 + 미션 카피 -->
            <div class="rental-card">
              {#if data.rental.product_name}<p class="product-name">{data.rental.product_name}</p>{/if}
              {#if data.rental.reservation_code}<p class="reservation-code">{data.rental.reservation_code}</p>{/if}
              <div class="date-row">
                <span class="date-label">반납 예정</span>
                <span class="date-value">{formatDate(data.rental.end_date)}{data.rental.return_time ? ` ${data.rental.return_time}` : ''}</span>
              </div>
            </div>
            <div class="mission-copy">
              {#if missionPoints}
                <p class="mission-title big">상품반납등록 미션<br />클리어하면<br /><strong>{missionPoints.toLocaleString('ko-KR')} 포인트</strong>를 드려요</p>
              {:else}
                <p class="mission-title big">상품반납등록 미션<br />클리어하고<br />포인트 챙겨가세요!</p>
              {/if}
              <p class="mission-desc">사진 등록부터 이용 평가까지 3단계, 1분이면 끝나요.</p>
            </div>

          {:else if step === 1}
            <h2 class="card-title" tabindex="-1">{step1Title}</h2>
            {#if method === 'quick'}
              <div class="notice-banner">
                <p class="notice-title">퀵서비스로 반납을 진행 중이신가요?</p>
                <p class="notice-desc">대여 종료 시간은 매장 도착 기준이에요. 퀵 기사님께 장비를 인계하셨다면 아래에서 확인해 주세요.</p>
              </div>
              <div class="check-list">
                <button type="button" class="check-row" onclick={() => (handover = !handover)} aria-pressed={handover}>
                  <span class="checkbox-btn checkbox-btn-terms" class:checked={handover}>
                    <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                    <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
                  </svg>
                  </span>
                  <span class="check-label">퀵 기사님께 장비를 인계했어요</span>
                </button>
              </div>
            {:else}
              {#each mediaItems as item (item.key)}
                <!-- 항목마다 1장: 등록하면 추가 타일은 사라지고 썸네일(✕로 삭제 후 다시 등록)만 보인다 -->
                {@const canAdd = (uploads[item.key] ?? []).length < 1}
                <div class="section">
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
                    {#if canAdd}
                      <label class="thumb add">
                        <!-- 사진·영상 추가 — Stephen 제공 카메라+체크 SVG(2026-10-22) -->
                        <svg class="thumb-camera" xmlns="http://www.w3.org/2000/svg" width="27" height="25" viewBox="0 0 27 25" fill="none" aria-hidden="true">
                  <path d="M14.083 0C15.0796 0 16.0825 0.510281 16.8076 1.08594C17.3317 1.50199 17.8735 2.08307 18.1973 2.77051C18.7549 2.77311 19.1759 2.781 19.5166 2.82324C20.0975 2.89531 20.4701 3.05912 20.8975 3.27246C21.789 3.71752 22.5186 4.43027 22.9775 5.3125C23.2763 5.88697 23.3939 6.49644 23.4482 7.14746C23.4926 7.67972 23.4962 8.31411 23.4971 9.05762C22.6042 9.19279 21.7367 9.57013 21 10.2002V9.50391C21 8.52267 20.9994 7.86328 20.957 7.35547C20.916 6.86347 20.8423 6.62573 20.7598 6.4668C20.5476 6.05875 20.2058 5.72218 19.7803 5.50977C19.4594 5.3496 19.3812 5.32606 19.209 5.30469C18.9293 5.27001 18.5009 5.26758 17.4775 5.26758C16.6201 5.26758 16.0935 4.59686 15.9912 3.99414C15.9626 3.8265 15.7506 3.43909 15.2529 3.04395C14.7617 2.65403 14.2968 2.5 14.083 2.5H9.41699C9.22466 2.5 8.82636 2.63517 8.4043 3.00488C7.9844 3.37274 7.78504 3.75905 7.75391 3.96777C7.66059 4.5972 7.12088 5.26758 6.2666 5.26758C4.22993 5.26758 4.1544 5.29277 3.71973 5.50977C3.29423 5.72218 2.95244 6.05875 2.74023 6.4668C2.65766 6.62573 2.58401 6.86347 2.54297 7.35547C2.50062 7.86328 2.5 8.52267 2.5 9.50391V13.7637C2.5 14.7448 2.50062 15.4043 2.54297 15.9121C2.58402 16.4041 2.65764 16.6419 2.74023 16.8008C2.95244 17.2088 3.29423 17.5454 3.71973 17.7578C3.85975 17.8277 4.05467 17.8873 4.39941 17.9297C4.19279 18.7586 4.20268 19.626 4.42285 20.4453C3.77485 20.3916 3.17177 20.2793 2.60254 19.9951C1.7109 19.55 0.981366 18.8365 0.522461 17.9541C0.223736 17.3796 0.106052 16.7702 0.0517578 16.1191C-0.00122524 15.4835 -2.17245e-07 14.7026 0 13.7637V9.50391C-7.53113e-08 8.56475 -0.00126103 7.78324 0.0517578 7.14746C0.106074 6.49644 0.223705 5.88697 0.522461 5.3125C0.981373 4.43026 1.71104 3.71751 2.60254 3.27246C3.51258 2.81816 4.17018 2.77361 5.52344 2.76953C5.80576 2.11761 6.27189 1.54887 6.75684 1.12402C7.4369 0.528329 8.39914 9.07538e-07 9.41699 0H14.083ZM11.75 7.33984C14.3491 7.33984 16.4999 9.41043 16.5 12.0186C16.5 13.9575 15.3107 15.5983 13.6328 16.3135L12.5039 15.3467C11.1195 14.1601 9.27318 13.8628 7.66113 14.4014C7.24222 13.7057 7 12.8925 7 12.0186C7.00009 9.41043 9.15093 7.33985 11.75 7.33984Z" style="fill: var(--cs-purple)"/>
                  <path d="M9.25 19.1429L13.75 23L24.25 14" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--cs-purple-pale)"/>
                </svg>
                        <span class="thumb-label">{item.label}{rules?.photosRequired ? '' : ' (선택)'}</span>
                        <input type="file" accept={ACCEPT} multiple aria-label={`${item.label} 추가`} onchange={(e) => onPick(item.key, e)} />
                      </label>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}

          {:else if step === 2}
            <h2 class="card-title" tabindex="-1">{step2Title}</h2>
            {#if rules?.checklist}
              <p class="card-sub">반납하실 상품과 체크 항목을 비교해 해당되는 항목의 체크버튼을 선택해주세요.</p>
            {/if}
            {#if rules?.checklist}
              <div class="check-list">
                {#each checklistItems as item (item.key)}
                  <button type="button" class="check-row" onclick={() => (checked[item.key] = !checked[item.key])} aria-pressed={!!checked[item.key]}>
                    <span class="checkbox-btn checkbox-btn-terms" class:checked={!!checked[item.key]}>
                      <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                    <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
                  </svg>
                    </span>
                    <span class="check-label">{item.label}</span>
                  </button>
                {/each}
              </div>
            {:else if rules?.lockerInfo}
              <div class="warn-banner" role="alert">
                <p class="warn-title">대여 종료 시간까지 입력이 없으면 지연 연체 요금이 발생할 수 있어요!</p>
                <p class="notice-desc">무인함에 장비를 넣은 뒤 무인함 번호·비밀번호를 꼭 입력해 주세요.</p>
              </div>
              <div class="section">
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
              <!-- 무인함 반납 시간 연장 요청 — 고객용 연장 기능이 없어 이 예약 컨텍스트의 크레이지챗으로 연결(플랜 기본값). 연체 요금은 종료 시간 기준으로 발생할 수 있다 -->
              <div class="extend-wrap">
                <a class="extend-link" href={`/chat?context=reservation&id=${reservationId}`} target="_blank" rel="noopener noreferrer">반납 시간 연장 요청 (크레이지챗)</a>
                <p class="hint">종료 시간까지 반납이 어려우면 먼저 채팅으로 연장을 요청해 주세요. 요청 없이 늦으면 연체 요금이 발생할 수 있어요.</p>
              </div>
            {:else}
              <!-- 퀵: 읽기 전용 반납 안내 -->
              <div class="rental-card">
                <p class="product-name">반납 예정 시각</p>
                <p class="mission-title small">{formatDate(data.rental.end_date)}{data.rental.return_time ? ` ${data.rental.return_time}` : ''}</p>
                <p class="notice-desc">퀵 기사님이 장비를 매장에 전달한 시각이 대여 종료 시간이에요. 예정 시각을 넘기면 연체 요금이 발생할 수 있어요.</p>
              </div>
            {/if}

          {:else if step === 3}
            <h2 class="card-title" tabindex="-1">{STEP_TITLE[3]}</h2>
            <div class="feedback-card">
              <p class="feedback-q">고객 이용 평가를 등록해주세요.</p>
              <p class="notice-desc">({FEEDBACK_MAX}자 이내 자유로운 내용으로 입력해주세요)</p>
              <!-- 평가 점수 5개 — Stephen 제공 아이콘(별표 대체). 선택한 점수까지 전체 컬러, 나머지는 흐리게 -->
              <div class="rating-row" role="radiogroup" aria-label="이용 평가 점수" bind:this={ratingRowEl} onpointerdown={onRatingDown} onpointermove={onRatingMove} onpointerup={onRatingUp} onpointercancel={onRatingUp}>
                {#each [1, 2, 3, 4, 5] as n (n)}
                  <button type="button" class="rating-btn" class:on={n <= rating} style="--i: {n - 1}" role="radio" aria-checked={rating === n} aria-label={`${n}점`} onclick={(e) => { if (e.detail === 0) { rating = rating === n ? 0 : n; popId++ } }}>
                    {#key popId}
                    <span class="rating-pop" class:pop={popId > 0 && n <= rating}>
                    <svg class="rating-icon" xmlns="http://www.w3.org/2000/svg" width="95" height="94" viewBox="0 0 95 94" fill="none" aria-hidden="true">
                      <circle cx="46.8469" cy="46.8469" r="46.8469" fill="#FFB3B3"/>
                      <circle cx="47.0002" cy="47" r="42" fill={`url(#ratingGrad${n})`}/>
                      <circle cx="47.145" cy="47.1453" r="16.7097" fill="white"/>
                      <path d="M88.0056 55.6149C87.6503 58.6879 86.5952 61.2082 84.8191 63.1647C83.0952 65.0329 80.8908 66.3593 78.2058 67.1331C75.573 67.8737 72.7 68.1169 69.5344 67.929C66.8389 67.7963 64.1539 67.3984 61.4271 66.7794C60.6122 66.5915 60.1108 65.884 60.2048 65.1102C60.3302 64.0712 60.4555 63.0431 60.5913 62.0151C60.6645 61.3519 60.7481 60.7108 60.8316 60.0696C60.9675 58.8647 62.4092 57.9694 63.6838 58.2347C65.6166 58.6879 67.4136 58.9642 69.1269 59.0748C71.5821 59.2516 73.5671 59.1079 75.082 58.6215C76.6282 58.091 77.4432 57.2398 77.579 56.1123C77.673 55.3164 77.3387 54.7195 76.5865 54.2552C75.8342 53.791 74.8104 53.393 73.5462 53.0835C72.3134 52.774 71.0075 52.4203 69.6389 52.0223C68.2703 51.6023 66.9852 51.0717 65.7524 50.4195C64.5718 49.7563 63.642 48.8388 62.9734 47.7002C62.3465 46.5285 62.148 45.0141 62.3674 43.157C62.6391 40.8468 63.5793 38.7907 65.1569 36.9226C66.7554 35.0434 68.7822 33.4074 71.2373 32.0588C73.797 30.6329 76.5656 29.6049 79.6267 28.9416C82.2803 28.3779 85.0071 28.1457 87.7339 28.2563C88.5906 28.3005 89.0921 28.9748 88.9772 29.8812C88.8205 31.1082 88.6638 32.3352 88.5175 33.529C88.4339 34.2144 88.3608 34.9329 88.2981 35.6072C88.1309 37.0663 86.5534 38.2712 85.2265 38.028C83.6072 37.7627 82.0505 37.6853 80.5669 37.7738C78.3103 37.8843 76.4924 38.2822 75.0507 38.9897C73.6507 39.6419 72.888 40.4599 72.7731 41.4768C72.6895 42.2064 73.003 42.748 73.7761 43.1128C74.5492 43.4776 75.5313 43.7761 76.785 44.0192C78.0491 44.2514 79.4073 44.5388 80.7759 44.9367C82.155 45.2905 83.4296 45.8874 84.6415 46.6611C85.8534 47.4349 86.8041 48.5403 87.4414 49.9663C88.0787 51.3923 88.2772 53.2493 88.0056 55.6149Z" fill="#271B7A"/>
                      <path d="M79.8774 22.9393C83.0117 22.2208 86.2086 21.9113 89.3428 22.0218C89.3498 22.0218 89.3568 22.0218 89.3637 22.0218C89.3637 22.0218 89.3672 22.0218 89.3742 22.0218C93.1562 22.1877 95.3919 25.3491 94.9427 29.2401C94.9427 29.2401 94.9427 29.2438 94.9427 29.2511C94.9427 29.2511 94.9427 29.2548 94.9427 29.2622C94.7964 30.5113 94.6502 31.7162 94.5144 32.899C94.4412 33.5511 94.3681 34.2033 94.3054 34.8997C94.3054 34.9071 94.3019 34.9145 94.2949 34.9218C93.992 38.0059 92.2472 40.5815 90.0219 42.2396C91.3174 43.356 92.3517 44.7488 93.1039 46.4069C93.1736 46.5764 93.2398 46.7422 93.3024 46.9043C94.3054 49.3804 94.4621 52.2545 94.1591 55.1617C94.1591 55.169 94.1591 55.1764 94.1591 55.1838C94.1591 55.1911 94.1591 55.1985 94.1591 55.2059C93.689 59.3732 92.195 63.5516 89.1025 67.0005C86.3235 70.0182 82.8654 71.9969 79.0416 73.0249C79.0347 73.0249 79.0312 73.0249 79.0312 73.0249C75.4999 73.9534 71.8537 74.1634 68.1449 73.8871C65.0524 73.6771 61.9913 73.1796 58.9511 72.4501C58.9441 72.4427 58.9406 72.439 58.9406 72.439C58.9337 72.439 58.9302 72.439 58.9302 72.439C55.6915 71.6542 53.6438 68.9349 54.0512 65.6298C54.0443 65.6224 54.0443 65.6113 54.0512 65.5966C54.187 64.5686 54.3333 63.5516 54.4796 62.5457C54.5527 61.9156 54.6363 61.2524 54.7408 60.5781C55.1587 57.5162 57.1541 55.2722 59.4944 53.9015C58.7212 53.1609 58.0422 52.3208 57.4989 51.3701C57.485 51.3628 57.4745 51.348 57.4675 51.3259C57.4606 51.3112 57.4501 51.2928 57.4362 51.2707C56.287 49.1151 56.0989 46.6059 56.4332 44.0635C56.9034 40.5372 58.4601 37.1216 61.1137 34.0375C61.1277 34.0154 61.1451 33.997 61.166 33.9822C63.5584 31.1524 66.4419 28.809 69.6702 26.974C69.6807 26.974 69.6807 26.974 69.6911 26.963C72.9194 25.0727 76.3044 23.7684 79.8774 22.9393ZM79.0625 29.0743C76.2208 29.7486 73.6298 30.7324 71.2373 32.0588C68.7822 33.4074 66.7554 35.0434 65.1569 36.9226C63.5793 38.7907 62.6391 40.8468 62.3674 43.157C62.148 45.0141 62.3465 46.5285 62.9734 47.7002C63.642 48.8388 64.5718 49.7563 65.7524 50.4195C65.9056 50.4932 66.0589 50.5743 66.2121 50.6627C67.3091 51.2043 68.427 51.6575 69.6389 52.0223C70.3075 52.2066 70.9762 52.3945 71.6448 52.5861C72.2925 52.7629 72.9298 52.9177 73.5462 53.0835C74.8104 53.393 75.8342 53.791 76.5865 54.2552C77.3387 54.7195 77.673 55.3164 77.579 56.1123C77.4432 57.2398 76.6282 58.091 75.082 58.6215C74.9845 58.651 74.887 58.6805 74.7895 58.71C73.3164 59.119 71.4254 59.2406 69.1269 59.0748C67.4136 58.9642 65.6166 58.6879 63.6838 58.2347C62.4092 57.9694 60.9675 58.8647 60.8316 60.0696C60.7481 60.7108 60.6645 61.3519 60.5913 62.0151C60.4555 63.0431 60.3302 64.0712 60.2048 65.1102C60.2048 65.1544 60.2013 65.1987 60.1943 65.2429C60.1734 65.9724 60.6645 66.6136 61.4271 66.7794C64.1539 67.3984 66.8389 67.7963 69.5344 67.929C72.491 68.1059 75.2074 67.8958 77.7148 67.2658C77.8819 67.2142 78.0456 67.17 78.2058 67.1331C80.8908 66.3593 83.0952 65.0329 84.8191 63.1647C86.4802 61.3408 87.5145 58.9974 87.9429 56.1786C87.9638 55.9944 87.9847 55.8065 88.0056 55.6149C88.2772 53.2493 88.0787 51.3923 87.4414 49.9663C86.8354 48.6288 85.9787 47.5786 84.8504 46.8048C84.7808 46.7606 84.7111 46.7127 84.6415 46.6611C83.4296 45.8874 82.155 45.2905 80.7759 44.9367C79.4073 44.5388 78.0491 44.2514 76.785 44.0192C75.5313 43.7761 74.5492 43.4776 73.7761 43.1128C73.003 42.748 72.6895 42.2064 72.7731 41.4768C72.8776 40.5372 73.5567 39.7524 74.7999 39.1113C74.8905 39.0671 74.9741 39.0265 75.0507 38.9897C76.4924 38.2822 78.3103 37.8843 80.5669 37.7738C80.748 37.759 80.9326 37.748 81.1207 37.7406C82.4475 37.6964 83.8161 37.7959 85.2265 38.028C86.5534 38.2712 88.1309 37.0663 88.2981 35.6072C88.3608 34.9329 88.4339 34.2144 88.5175 33.529C88.6777 32.3131 88.8309 31.0972 88.9772 29.8812C89.0921 28.9748 88.5906 28.3005 87.7339 28.2563C85.0071 28.1457 82.2803 28.3779 79.6267 28.9416C79.4386 28.9858 79.2506 29.0301 79.0625 29.0743Z" fill="white"/>
                      <path d="M23.8871 48.203C24.542 44.7389 25.6769 41.5172 27.2631 38.5557C28.9095 35.5213 30.9353 32.7846 33.3345 30.361C35.7294 27.9009 38.4452 25.826 41.4767 24.1591C44.5073 22.4848 47.7265 21.3062 51.1366 20.6449C54.2775 20.0353 57.5054 19.9693 60.8336 20.4306C61.4416 20.5262 61.7763 21.0943 61.6556 21.8228C61.3779 23.4905 61.1078 25.1572 60.8251 26.8475C60.6284 28.0343 60.4384 29.2129 60.2409 30.3924C60.0384 31.5946 58.7365 32.5558 57.7639 32.2862C55.9942 31.809 54.1833 31.6313 52.3312 31.7531C49.7592 31.9317 47.3479 32.631 45.0765 33.868C42.8035 35.0905 40.864 36.8075 39.2414 39.0059C37.6195 41.1453 36.5293 43.7722 35.9499 46.9035C35.3697 50.0276 35.5214 52.5479 36.4051 54.4644C37.293 56.3509 38.6964 57.6794 40.6465 58.454C42.5899 59.2367 44.8776 59.4359 47.5314 59.0419C49.4418 58.7662 51.4152 58.1812 53.4525 57.2943C54.5726 56.8029 55.6042 57.5084 55.3942 58.7114C55.1917 59.9135 54.9816 61.1165 54.7657 62.3349C54.4863 63.9879 54.1985 65.6345 53.9124 67.2957C53.7841 68.0251 53.2286 68.6981 52.5451 68.9352C48.8334 70.1531 45.4207 70.7925 42.2776 70.864C38.8592 70.9361 35.8464 70.4255 33.2324 69.3402C30.6144 68.2848 28.5028 66.7241 26.8944 64.6953C25.2903 62.7029 24.2064 60.3216 23.6453 57.5733C23.1412 54.7893 23.2238 51.6607 23.8871 48.203Z" fill="#CF0000"/>
                      <path d="M50.0869 15.6163C53.6248 14.9297 57.2215 14.8257 60.8623 15.2597L61.5905 15.3535L61.6406 15.3602L61.6908 15.3684C63.6284 15.6733 65.226 16.8006 66.1422 18.3534C67.0045 19.8149 67.1184 21.3697 66.9095 22.6315L66.9085 22.636C66.6421 24.2359 66.3544 26.0027 66.0779 27.6559L66.0787 27.6566C65.8888 28.8024 65.6893 30.0372 65.4929 31.2101L65.4926 31.2144C65.1461 33.2713 63.935 34.8991 62.5732 35.9281C61.3148 36.8789 59.0163 37.9537 56.331 37.2249C55.157 36.9084 53.9598 36.7888 52.7131 36.8687C50.9284 36.9927 49.2803 37.4698 47.6933 38.3341L47.6807 38.3405L47.6688 38.3476C46.1486 39.1651 44.7847 40.3423 43.5761 41.9799L43.5568 42.0065L43.5367 42.0325C42.4832 43.4221 41.6541 45.2812 41.1872 47.8044L41.1869 47.808C40.7107 50.3719 40.9771 51.7311 41.2552 52.355C41.6022 53.0874 42.0198 53.4518 42.6731 53.7113L42.6849 53.7165L42.6974 53.7209C43.5283 54.0555 44.7839 54.2598 46.7219 53.9721L46.733 53.9709L46.744 53.9689C48.0953 53.7739 49.597 53.3448 51.2627 52.6197C53.2727 51.7429 55.913 51.6928 58.0879 53.2453C60.3106 54.8321 61.0148 57.3532 60.6443 59.5334L60.6458 59.5339C60.4423 60.7419 60.2309 61.9467 60.0162 63.1592L60.017 63.1598C59.7359 64.8225 59.4443 66.4913 59.161 68.1357L59.1591 68.1446L59.1578 68.1527C58.7379 70.5415 56.9951 72.8425 54.3464 73.7615L54.3033 73.7763L54.2595 73.7911C50.1538 75.1383 46.1991 75.9055 42.4032 75.9918L42.3943 75.9921C38.3784 76.0769 34.6032 75.4835 31.1803 74.0721C31.169 74.0675 31.1578 74.063 31.1465 74.0585C31.1404 74.0559 31.1339 74.0537 31.1278 74.0512C27.7282 72.6712 24.879 70.5868 22.6925 67.8397L22.6918 67.8405C22.6837 67.8304 22.6754 67.8202 22.6673 67.8101L22.668 67.8093C20.5124 65.1213 19.1249 61.9915 18.4251 58.5639L18.4142 58.5096L18.4041 58.4552C17.7685 54.9452 17.905 51.1916 18.6536 47.283C19.3996 43.3374 20.7 39.6307 22.5362 36.2024L22.5422 36.1902L22.549 36.178C24.4129 32.7429 26.7167 29.6226 29.4552 26.8504C32.2068 24.0239 35.34 21.6283 38.8407 19.7033C42.3527 17.7644 46.106 16.3883 50.0869 15.6163ZM50.4993 20.7752C47.3248 21.4557 44.3178 22.5896 41.4767 24.1591L40.9123 24.4766C38.1072 26.0871 35.5798 28.0546 33.3345 30.361L32.8893 30.819C30.6838 33.1279 28.8066 35.7109 27.2631 38.5557C25.6769 41.5172 24.542 44.7389 23.8871 48.203C23.2238 51.6607 23.1412 54.7893 23.6453 57.5733C24.2064 60.3216 25.2903 62.7029 26.8944 64.6953C28.5028 66.7241 30.6144 68.2848 33.2324 69.3402C35.8464 70.4255 38.8592 70.9361 42.2776 70.864C45.2242 70.7969 48.4078 70.2308 51.8524 69.1569L52.5451 68.9352C53.2286 68.6981 53.7841 68.0251 53.9124 67.2957C54.1985 65.6345 54.4863 63.9879 54.7657 62.3349C54.9816 61.1165 55.1917 59.9135 55.3942 58.7114C55.6042 57.5084 54.5726 56.8029 53.4525 57.2943L53.0714 57.4571C51.169 58.2532 49.3224 58.7834 47.5314 59.0419C45.0435 59.4113 42.8774 59.259 41.015 58.5937L40.6465 58.454C38.6964 57.6794 37.293 56.3509 36.4051 54.4644C35.5214 52.5479 35.3697 50.0276 35.9499 46.9035C36.4931 43.968 37.4856 41.4757 38.9439 39.4129L39.2414 39.0059C40.7625 36.945 42.5623 35.3072 44.6541 34.1032L45.0765 33.868C47.3479 32.631 49.7592 31.9317 52.3312 31.7531C54.1833 31.6313 55.9942 31.809 57.7639 32.2862C58.7061 32.5472 59.9573 31.6535 60.2188 30.5045L60.2409 30.3924C60.4384 29.2129 60.6284 28.0343 60.8251 26.8475L61.6556 21.8228C61.7763 21.0943 61.4416 20.5262 60.8336 20.4306C57.5054 19.9693 54.2775 20.0353 51.1366 20.6449L50.4993 20.7752Z" fill="white"/>
                      <defs>
                        <radialGradient id={`ratingGrad${n}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(47.0002 47) rotate(90) scale(42)">
                          <stop offset="0.831731" stop-color="#CF0000"/>
                          <stop offset="1" stop-color="#FFB3B3"/>
                        </radialGradient>
                      </defs>
                    </svg>
                    </span>
                    {/key}
                  </button>
                {/each}
              </div>
              <textarea
                class="cs-textarea"
                rows="8"
                maxlength={FEEDBACK_MAX}
                bind:value={feedback}
                placeholder="예: 반납 안내가 친절하고 쉬웠어요"
                aria-label="고객 이용 평가"
              ></textarea>
              <p class="feedback-count" aria-live="polite">{feedback.length}/{FEEDBACK_MAX}</p>
            </div>

          {:else}
            <!-- 완료 카드 -->
            <div class="done-group">
              <div class="hands-wrap" aria-hidden="true">
                <img class="done-hands" src="/return-steps/finger-heart.png" alt="" />
                {#each hearts as h, i (i)}
                  <span class="burst-heart" style="--dx:{h.dx}px; --dy:{h.dy}px; --s:{h.s}; --r:{h.r}deg; --d:{h.d}ms"><img class="burst-img" src="/return-steps/heart.png" alt="" /></span>
                {/each}
              </div>
              <div class="mission-copy" role="status">
                <p class="mission-title big">상품반납등록 미션<br />완벽 클리어!</p>
                {#if missionPoints}
                  <p class="mission-desc">고객님께 <strong>{missionPoints.toLocaleString('ko-KR')} 포인트</strong>를 적립해 드릴게요.<br />내정보 &gt; 포인트에서 확인해보세요.</p>
                {:else}
                  <p class="mission-desc">반납 정보가 안전하게 접수됐어요. 검수가 끝나면 알림으로 안내해 드릴게요.</p>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/key}

      {#if errorMsg}<p class="save-error" role="alert">{errorMsg}</p>{/if}
    {/if}
  </div>

  {#if method && data.canSubmit}
    <div class="bottom-cta" class:with-hand={step === 1 || step === 2 || step === 3}>
      {#if step === 'intro'}
        <div class="intro-cta">
          <span class="scatter s1" aria-hidden="true"><ReturnStepFinger step={1} size={107} showWord={false} /></span>
          <span class="scatter s2" aria-hidden="true"><ReturnStepFinger step={2} size={125} showWord={false} /></span>
          <span class="scatter s3" aria-hidden="true"><ReturnStepFinger step={3} size={134} showWord={false} /></span>
          <button type="button" class="btn-cta" onclick={goNext}>반납등록 시작하기</button>
        </div>
      {:else if step === 1}
        <div class="cta-row">
          <span class="cta-finger" aria-hidden="true"><ReturnStepFinger step={1} size={132} showWord={false} /></span>
          <button type="button" class="btn-cta" onclick={goNext} disabled={!canNext1}>등록완료, 다음단계 GO</button>
        </div>
      {:else if step === 2}
        <div class="cta-row">
          <span class="cta-finger" aria-hidden="true"><ReturnStepFinger step={2} size={172} showWord={false} /></span>
          <button type="button" class="btn-cta" onclick={goNext} disabled={!canNext2}>등록완료, 마지막단계 GO</button>
        </div>
      {:else if step === 3}
        <div class="cta-row">
          <span class="cta-finger" aria-hidden="true"><ReturnStepFinger step={3} size={172} showWord={false} /></span>
          <button type="button" class="btn-cta" onclick={submit} disabled={!canConfirm}>
            {#if isSaving}등록 중...{:else}등록완료, 포인트 받기{/if}
          </button>
        </div>
      {:else}
        <button type="button" class="btn-cta" onclick={goPoints}>포인트 확인하기</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page-wrap { overflow-x: clip; min-height: 100dvh; background: var(--cs-lilac, #ECEBF4); display: flex; flex-direction: column; max-width: 480px; margin: 0 auto; padding-bottom: 220px; }
  .page-header { position: sticky; top: 0; z-index: 10; background: var(--cs-dark, #100B32); color: #fff; display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px; min-height: 56px; }
  .back-btn { background: none; border: none; color: #fff; font-size: 24px; line-height: 1; cursor: pointer; padding: 8px; min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md, 15px); transition: background 0.15s; }
  .back-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .page-title { font: 700 16px/1 'Noto Sans KR', sans-serif; color: #fff; }
  .polaroid-bg { position: fixed; top: 0; bottom: 0; left: 50%; width: 100%; max-width: 480px; transform: translateX(-50%); z-index: 0; pointer-events: none; overflow: hidden; }
  .polaroid-bg::after { content: ''; position: absolute; inset: 0; background: rgba(236, 235, 244, 0.35); z-index: 10; transition: background 0.3s; }
  .polaroid-bg.dim::after { background: rgba(236, 235, 244, 0.8); } /* 1~3단계·완료 화면은 소개보다 진한 베일 */ /* 글자 가독성용 옅은 베일 */
  .polaroid { position: absolute; width: 440px; padding: 24px 24px 84px; background: #fff; border-radius: 10px; box-shadow: 0 10px 30px rgba(16, 11, 50, 0.22); }
  .polaroid img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: var(--cs-surface-gray, #f6f6f6); }
  .content { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; gap: 16px; padding: 16px; }

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

  /* 체크 항목은 한 줄씩 떨어진 카드로 배치(2026-10-22, Stephen 지시) — 목록 컨테이너는 배경 없이 간격만, 각 항목이 흰 카드 */
  .check-list { display: flex; flex-direction: column; gap: 12px; }
  .check-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 10px 20px; background: #fff; border: none; border-radius: var(--radius-lg, 20px); cursor: pointer; text-align: left; }
  .check-label { font: var(--text-m-body-16B); color: var(--cs-text, #100B32); word-break: keep-all; } /* 체크 항목 글자: 14px 일반 → 한 단계 위 볼드 토큰(16px 700, 2026-10-22) */
  .checkbox-btn { flex-shrink: 0; display: inline-flex; }
  .checkbox-btn-terms { color: var(--cs-purple-op10, rgba(59, 47, 138, 0.1)); }
  .checkbox-btn-terms.checked { color: var(--cs-purple, #3B2F8A); }
  /* 체크 선택 시 카드 색 반전(2026-10-22, Stephen 지시): 흰 배경·진한 글자 → 퍼플 배경·흰 글자·흰 체크 */
  .check-row { transition: background 0.15s; }
  .check-row[aria-pressed='true'] { background: var(--cs-purple, #3B2F8A); }
  .check-row[aria-pressed='true'] .check-label { color: var(--cs-white, #fff); }
  .check-row[aria-pressed='true'] .checkbox-btn-terms.checked { color: var(--cs-white, #fff); }
  .checkbox-btn-terms svg { width: 22px; height: 15px; }
  @media (min-width: 768px) { .checkbox-btn-terms svg { width: 18px; height: 12px; } }

  .thumb-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; } /* 사진 추가 칸·미리보기를 화면 가운데로 정렬(2026-10-22, Stephen 지시) */
  .thumb { position: relative; width: 176px; height: 176px; border-radius: var(--radius-xl, 30px); overflow: hidden; background: #fff; display: flex; align-items: center; justify-content: center; }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; }
  .thumb.add { cursor: pointer; font: 400 28px/1 'Noto Sans KR', sans-serif; color: var(--cs-purple, #3B2F8A); }
  .thumb.add input { display: none; }
  .thumb-camera { width: 54px; height: 50px; flex-shrink: 0; } /* 첨부 SVG 원본 크기(Stephen 제공, 색은 토큰 --cs-purple·--cs-red 로 매핑) */
  /* 사진 추가 칸 기본 배경 = 보라→분홍 그라데이션(2026-10-22, Stephen 지시 — 화면에 보인 썸네일 색). 바탕이 짙어져 카메라 아이콘 본체·글자는 흰색으로 */
  .thumb.add { flex-direction: column; gap: 12px; background: linear-gradient(135deg, var(--cs-purple-light, #553FE0) 0%, var(--cs-red-light, #FFB3B3) 100%); }
  .thumb.add .thumb-label { color: var(--cs-white, #fff); }
  .thumb.add .thumb-camera path:first-of-type { fill: var(--cs-white, #fff) !important; } /* 사진 추가 칸 2배(88 → 176px)·라운드 2배(15 → 30px, 2026-10-22 Stephen 지시) — 업로드된 미리보기 썸네일도 같은 크기(2026-10-22, 사진 등록 시 추가 칸과 동일한 UI 크기로 적용) */
  .thumb-label { font: var(--text-pc-title-16); line-height: 1.25; text-align: center; color: var(--cs-text); padding: 0 6px; word-break: keep-all; }
  .thumb-remove { position: absolute; top: 13px; right: 13px; width: 28px; height: 28px; min-width: 28px; min-height: 28px; border: none; border-radius: 50%; background: rgba(16, 11, 50, 0.6); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; }
  .thumb-remove:hover { background: var(--cs-red-badge, #FF3535); }

  .field { display: flex; flex-direction: column; gap: 6px; }
  .field-label { font: 700 12px/1 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); padding: 0 4px; }
  .cs-input { background: #fff; border: none; border-radius: var(--radius-sm, 8px); padding: 12px 20px; min-height: 44px; font: 400 14px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); }
  .cs-input:focus { outline: 2px solid var(--cs-purple, #3B2F8A); outline-offset: -2px; }

  .hint { font: 400 13px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); margin: 0; padding: 0 4px; }
  .save-error { font: 400 13px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-error, #E53935); margin: 0; padding: 0 4px; }

  .bottom-cta { z-index: 5; position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; padding: 16px; background: linear-gradient(to top, var(--cs-lilac, #ECEBF4) 60%, transparent); box-sizing: border-box; }
  /* 손가락 이미지(172px, 132px의 +30%)가 버튼 세로 중앙(20px 위)에 걸쳐 버튼 아래로 40px 나오므로, 그만큼 하단 여백을 둬 화면 아래에서 잘리지 않게 한다(2026-10-22) */
  .bottom-cta.with-hand { padding-bottom: calc(48px + env(safe-area-inset-bottom, 0px)); }
  .extend-wrap { max-width: 480px; margin: 0 auto; padding: 0 var(--layout-mob-pad, 25px) 12px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .extend-link { display: inline-flex; align-items: center; min-height: 44px; color: var(--cs-purple, #3B2F8A); font: 700 14px/1 'Noto Sans KR', sans-serif; text-decoration: underline; }
  .btn-cta { width: 100%; background: var(--cs-purple, #3B2F8A); border: none; border-radius: var(--radius-xl, 30px); min-height: 52px; font: 700 16px/1 'Noto Sans KR', sans-serif; color: #fff; cursor: pointer; transition: background 0.15s; }
  .btn-cta:hover:not(:disabled) { background: var(--cs-purple-hover, #2E2470); }
  .btn-cta:disabled { background: #B0ABCC; cursor: not-allowed; }
  /* 카드 슬롯(2026-10-22) */
  .slot-card { display: flex; flex-direction: column; gap: 16px; }
  .card-title { font: var(--text-m-title-18B); color: var(--cs-text, #100B32); margin: 4px 4px 0; text-align: center; outline: none; }
  .card-sub { font: var(--text-m-script-14); color: var(--cs-text-mid, #666); margin: -8px 4px 4px; text-align: center; word-break: keep-all; } /* 카드 제목 아래 서브 안내 문구(2026-10-22) — 폰트 토큰 한 단계 위(13px → --text-m-script-14, 14px) */
  .slot-card.intro { flex: 1; }
  .slot-card.done { flex: 1; justify-content: center; } /* 완료 화면: 안내 박스를 세로 중앙에 */
  .slot-card.done .done-group { display: flex; flex-direction: column; transform: translateY(110px); }
  .hands-wrap { position: relative; align-self: center; width: 336px; max-width: none; height: 336px; margin: -20px 0 -90px; z-index: 1; pointer-events: none; } /* 손 이미지(336px)는 카피 카드 뒤 레이어 — 카드가 아래쪽을 살짝 덮는다 */
  .done-group .mission-copy { position: relative; z-index: 2; }
  .done-hands { width: 100%; height: 100%; display: block; animation: hands-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  /* 하트 폭죽 — 이동(바깥 span)과 확대·페이드(안쪽 img)를 따로 돌려 구간마다 멈칫하지 않고 부드럽게 퍼진다. 한 바퀴 1.1초, 반복 */
  .burst-heart { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; opacity: 1; transform: translate(-50%, -50%); animation: heart-fly 1.1s cubic-bezier(0.1, 0.75, 0.25, 1) var(--d, 0ms) infinite both; will-change: transform; }
  .burst-img { display: block; width: 100%; height: auto; opacity: 0; transform: scale(0); animation: heart-pop 1.1s ease-out var(--d, 0ms) infinite both; will-change: transform, opacity; }
  @keyframes hands-pop { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes heart-fly {
    0%   { transform: translate(-50%, -50%) translate(0, 0) rotate(0deg); }
    100% { transform: translate(-50%, -50%) translate(var(--dx), var(--dy)) rotate(var(--r)); }
  }
  @keyframes heart-pop {
    0%   { transform: scale(0); opacity: 0; }
    14%  { transform: scale(calc(var(--s) * 1.25)); opacity: 1; }
    40%  { transform: scale(var(--s)); opacity: 1; }
    100% { transform: scale(calc(var(--s) * 1.3)); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .burst-heart { display: none; } .done-hands { animation: none; } }
  .slot-card.intro .mission-copy { margin-top: auto; margin-bottom: -64px; } /* 소개 화면: 안내 박스를 아래(시작 버튼 쪽)로 */
  .mission-copy { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 16px; text-align: center; background: rgba(255, 255, 255, 0.6); border-radius: var(--radius-xl, 30px); } /* 배경 사진 색과 무관하게 글자가 읽히도록 알파 BG */
  .mission-title { font: var(--text-m-htitle-24B); color: var(--cs-text, #100B32); margin: 0; line-height: 1.4; }
  .mission-title strong { color: var(--cs-red-badge, #FF3535); }
  .mission-title.big { font: var(--text-m-ad-kr-30); } /* 소개 화면 제목: 24px → 30px(2단계 큰 토큰) */
  .mission-title.small { font: var(--text-m-title-18B); }
  .mission-desc { font: var(--text-m-body-16B); color: var(--cs-purple, #3B2F8A); margin: 0; }
  .feedback-card { display: flex; flex-direction: column; gap: 8px; padding: 0 4px; } /* 흰 카드 배경 제거(2026-10-22, Stephen 지시) — 문구·입력창이 페이지 배경 위에 바로 놓인다 */
  /* 평가 점수 5개(2026-10-22, Stephen 제공 아이콘, 52 → 36px로 30% 축소 — 터치 영역은 44px 유지) — 선택한 점수까지 전체 컬러, 나머지는 그레이 톤. 설명 문구와 입력창 사이 여백 확보 */
  .rating-row { touch-action: none; user-select: none; display: flex; justify-content: center; gap: 8px; margin: 20px 0; align-self: center; width: fit-content; padding: 6px 16px; background: var(--cs-purple-op10, #E1DEF3); border-radius: var(--radius-xl, 30px); } /* 5개 아이콘을 한 덩어리로 묶는 배경(알약 모양) — 퍼플 계열 중 더 옅은 톤(2026-10-22, --cs-purple-pale → --cs-purple-op10) */
  .rating-btn { width: 44px; height: 44px; min-width: 44px; min-height: 44px; padding: 0; background: none; border: none; cursor: pointer; display: grid; place-items: center; }
  .rating-icon { width: 36px; height: 36px; opacity: 0.6; filter: grayscale(1); transition: opacity 0.15s, filter 0.15s, transform 0.15s; } /* 미선택 = 그레이 톤(흑백+알파, 2026-10-22) */
  .rating-btn.on .rating-icon { opacity: 1; filter: none; }
  .rating-btn:active .rating-icon { transform: scale(0.92); }
  /* 오픈 모션(2026-10-22): CMS 단계 배지(RentalJourneyStepper)와 같은 step-in — 아래에서 위로 올라오며 왼쪽부터 차례로 나타난다(스프링 곡선) */
  .rating-btn { animation: rating-in 0.5s cubic-bezier(0.34, 1.3, 0.64, 1) both; animation-delay: calc(var(--i, 0) * 70ms + 200ms); }
  @keyframes rating-in {
    0%   { opacity: 0; transform: translateY(22px) scale(0.8); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  /* 선택 모션(2026-10-22): 선택된 아이콘이 왼쪽부터 차례로 튀어 오르며(바운스) 뒤에서 버블이 퍼진다 */
  .rating-pop { position: relative; display: grid; place-items: center; width: 44px; height: 44px; }
  .rating-pop.pop .rating-icon { animation: rating-bounce 0.62s cubic-bezier(0.34, 1.56, 0.64, 1) both; animation-delay: calc(var(--i, 0) * 70ms); }
  .rating-pop.pop::before,
  .rating-pop.pop::after { content: ''; position: absolute; border-radius: 50%; pointer-events: none; opacity: 0; }
  /* 큰 버블 — 아이콘 뒤에서 커지며 사라진다 */
  .rating-pop.pop::before { inset: 2px; background: radial-gradient(circle, rgba(207, 0, 0, 0.32) 0 52%, rgba(255, 179, 179, 0.28) 62%, transparent 70%); animation: rating-bubble 0.7s ease-out both; animation-delay: calc(var(--i, 0) * 70ms + 60ms); }
  /* 작은 버블 — 오른쪽 위로 떠오른다 */
  .rating-pop.pop::after { width: 10px; height: 10px; top: 4px; right: 2px; background: radial-gradient(circle at 35% 35%, #fff 0 25%, rgba(193, 187, 236, 0.9) 60%, rgba(85, 63, 224, 0.5) 100%); animation: rating-bubble-up 0.8s ease-out both; animation-delay: calc(var(--i, 0) * 70ms + 140ms); }
  @keyframes rating-bounce {
    0%   { transform: scale(0.55) rotate(-12deg); }
    35%  { transform: scale(1.42) rotate(8deg); }
    55%  { transform: scale(0.86) rotate(-4deg); }
    75%  { transform: scale(1.14) rotate(2deg); }
    100% { transform: scale(1) rotate(0); }
  }
  @keyframes rating-bubble {
    0%   { opacity: 0.9; transform: scale(0.4); }
    100% { opacity: 0; transform: scale(2.1); }
  }
  @keyframes rating-bubble-up {
    0%   { opacity: 0; transform: translate(0, 6px) scale(0.4); }
    30%  { opacity: 1; }
    100% { opacity: 0; transform: translate(6px, -20px) scale(1.1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .rating-btn, .rating-pop.pop .rating-icon, .rating-pop.pop::before, .rating-pop.pop::after { animation: none; }
  }
  .feedback-q, .feedback-card .notice-desc { text-align: center; } /* 질문·안내 문구 정중앙 정렬(2026-10-22) */
  .feedback-q { font: 700 15px/1.4 'Noto Sans KR', sans-serif; color: var(--cs-text, #100B32); margin: 0; }
  .cs-textarea { background: var(--cs-surface-gray, #f6f6f6); border: none; border-radius: var(--radius-md, 15px); padding: 14px 16px; min-height: 200px; resize: none; font: var(--text-m-body-16L); color: var(--cs-text, #100B32); }
  .cs-textarea:focus { outline: 2px solid var(--cs-purple, #3B2F8A); outline-offset: -2px; }
  .feedback-count { font: 400 12px/1 'Noto Sans KR', sans-serif; color: var(--cs-text-mid, #666); text-align: right; margin: 0; }
  .mission-desc strong { font-weight: 900; color: var(--cs-red-badge, #FF3535); }
  /* 단계 버튼 줄(2026-10-22): 버튼은 원래 크기(전체 폭)로 두고, 손가락 아이콘(172px)을 버튼 왼쪽에 겹쳐 얹는다(레이어). 버튼 글자는 아이콘을 피해 오른쪽으로 재정렬 — 하나·두울·세엣 글자는 소개 카드에서만 */
  .cta-row { position: relative; }
  .cta-finger { position: absolute; left: 6px; top: 50%; transform: translateY(calc(-50% - 20px)); z-index: 2; pointer-events: none; display: block; line-height: 0; } /* 버튼 세로 중앙에서 20px 위로(2026-10-22, 14 → 20px) */
  .cta-row .btn-cta { padding: 0 20px 0 120px; text-align: right; }
  .step-guide { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 12px; }
  .step-guide-label { font: var(--text-m-script-14B); color: var(--cs-text-mid, #666); margin: 0; }
  .intro-cta { position: relative; }
  .intro-cta .btn-cta { position: relative; z-index: 1; }
  .scatter { position: absolute; z-index: 0; pointer-events: none; display: block; line-height: 0; }
  .scatter.s1 { left: 2px; top: -78px; transform: rotate(-24deg); }
  .scatter.s2 { right: 6px; top: -87px; transform: rotate(20deg); }
  .scatter.s3 { left: calc(46% - 67px); top: -123px; transform: rotate(-6deg); }

</style>
