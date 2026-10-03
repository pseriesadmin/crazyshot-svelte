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
