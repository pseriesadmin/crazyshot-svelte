/**
 * 브라우저 Canvas API 기반 이미지 리사이즈 유틸
 *
 * Supabase Storage 업로드 전 사전 리사이즈로 Image Transformation API 비용 완전 회피.
 * 출력 포맷은 WebP 고정 (동일 화질 대비 최소 파일크기).
 *
 * 사용처: src/lib/components/cms/ProductDetailPanel.svelte (uploadFile 함수)
 */

/** 리사이즈 결과 */
export interface ResizedImage {
  thumb: Blob  // 400 × 300 — 목록 카드 썸네일
  large: Blob  // 1200 × 900 — 상세/라이트박스
}

/**
 * File → { thumb, large } WebP Blob 쌍 반환.
 * 원본이 목표 크기보다 작으면 업스케일하지 않는다.
 */
export async function resizeProductImage(file: File): Promise<ResizedImage> {
  const [thumb, large] = await Promise.all([
    resizeToBlob(file, 400, 300, 0.82),
    resizeToBlob(file, 1200, 900, 0.88),
  ])
  return { thumb, large }
}

async function resizeToBlob(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      // 업스케일 방지 (원본이 더 작으면 그대로)
      const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h

      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas context 생성 실패')); return }

      ctx.drawImage(img, 0, 0, w, h)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('WebP 변환 실패'))
        },
        'image/webp',
        quality,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('이미지 로드 실패'))
    }

    img.src = objectUrl
  })
}

/** 서버 업로드 파일 1건당 상한(/api/cms/upload와 같은 값 — 2026-10-17). Vercel 요청 본문 한도(약 4.5MB)보다 작게 4MB로 둔다 */
export const SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

/** 축소 시도 순서: 화질만 낮추고 → 크기까지 줄이며 점점 강하게(앞에서부터 상한 이하가 되는 첫 단계를 쓴다) */
export const SHRINK_STEPS: ReadonlyArray<{ scale: number; quality: number }> = [
  { scale: 1, quality: 0.85 },
  { scale: 1, quality: 0.7 },
  { scale: 0.8, quality: 0.7 },
  { scale: 0.6, quality: 0.65 },
  { scale: 0.45, quality: 0.6 },
  { scale: 0.3, quality: 0.55 },
]

export interface ShrinkOptions {
  /** 이 크기 이하로 만든다(기본 4MB) */
  maxBytes?: number
  /** 긴 변 최대 픽셀(기본 2000 — 라벨 글자가 읽히는 크기) */
  maxSide?: number
  /** 출력 형식(기본 JPEG — 모든 브라우저가 만들 수 있다) */
  mime?: 'image/jpeg' | 'image/webp'
}

/** 긴 변 제한과 단계별 배율을 합친 최종 크기(업스케일 없음, 최소 1px) */
export function shrinkTargetSize(w: number, h: number, maxSide: number, scale: number): { w: number; h: number } {
  const ratio = Math.min(1, (maxSide * scale) / Math.max(w, h))
  return { w: Math.max(Math.round(w * ratio), 1), h: Math.max(Math.round(h * ratio), 1) }
}

/**
 * 업로드 전 자동 줄임 — 상한 이하면 원본 그대로 돌려주고(화질 손실 없음), 넘으면 상한 이하가 될 때까지 화질·크기를 단계적으로 낮춘다.
 * 끝까지 줄여도 상한을 못 맞추거나 브라우저가 디코딩하지 못하면(일부 HEIC) Error를 던진다 — 호출부가 안내 문구를 띄운다.
 */
export async function shrinkImageToLimit(src: Blob, opts: ShrinkOptions = {}): Promise<Blob> {
  const maxBytes = opts.maxBytes ?? SERVER_UPLOAD_MAX_BYTES
  const maxSide = opts.maxSide ?? 2000
  const mime = opts.mime ?? 'image/jpeg'
  if (src.size <= maxBytes) return src

  const objectUrl = URL.createObjectURL(src)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('이미지를 읽을 수 없어요. 다른 형식으로 올려 주세요.'))
      el.src = objectUrl
    })
    for (const step of SHRINK_STEPS) {
      const { w, h } = shrinkTargetSize(img.naturalWidth, img.naturalHeight, maxSide, step.scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('이미지를 줄일 수 없어요.')
      if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h) } // 투명 배경이 검게 변하지 않게
      ctx.drawImage(img, 0, 0, w, h)
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, mime, step.quality))
      // 큰 캔버스가 단계마다 쌓이지 않게 즉시 비운다(모바일 메모리·iOS canvas 총량 한도 대비)
      canvas.width = 0
      canvas.height = 0
      // 브라우저가 요청한 형식으로 인코딩하지 못해 다른 형식(PNG 등)을 돌려주면 그 결과는 쓰지 않는다 — 서버는 형식도 검사한다
      if (blob && blob.type === mime && blob.size <= maxBytes) return blob
    }
    throw new Error(`이미지를 ${Math.round(maxBytes / 1024 / 1024)}MB 이하로 줄이지 못했어요.`)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * 프로필 아바타용 정사각 리사이즈 — 중앙 크롭 후 size×size WebP (기본 256px).
 * GNB·마이페이지에서 수십 px로 표시되는 이미지를 원본(수 MB)으로 서빙하던 트래픽을 줄인다(2026-10-03).
 * 원본이 size보다 작으면 업스케일하지 않고 짧은 변 기준 정사각으로만 자른다.
 * 브라우저가 디코딩하지 못하는 형식(예: 일부 HEIC)은 reject — 호출부에서 안내 문구를 띄우고 원본 업로드로 폴백하지 않는다.
 */
export async function resizeAvatar(file: File, size = 256, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      const side = Math.min(img.width, img.height)
      const out = Math.min(size, side)
      const sx = Math.round((img.width - side) / 2)
      const sy = Math.round((img.height - side) / 2)

      const canvas = document.createElement('canvas')
      canvas.width = out
      canvas.height = out

      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas context 생성 실패')); return }

      ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('WebP 변환 실패'))
        },
        'image/webp',
        quality,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('이미지 로드 실패'))
    }

    img.src = objectUrl
  })
}
