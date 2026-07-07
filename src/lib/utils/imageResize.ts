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
