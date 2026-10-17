/**
 * 업로드 전 자동 줄임(shrinkImageToLimit) — 실제 Chrome·Safari에서 큰 사진이 서버 상한(4MB) 이하로 줄어드는지 검증
 */
import { test, expect } from '@playwright/test'

test.describe('업로드 전 자동 줄임', () => {
  test('WebP 모드: 인코딩 가능한 브라우저에서는 WebP로 줄고, 못 하는 브라우저는 PNG를 쓰지 않고 실패한다', async ({ page }) => {
    await page.goto('/dev-e2e/editors?editor=viewer')
    const r = await page.evaluate(async () => {
      const mod = await import('/src/lib/utils/imageResize.ts')
      const c = document.createElement('canvas')
      c.width = 3000; c.height = 2000
      const ctx = c.getContext('2d')!
      const id = ctx.createImageData(c.width, c.height)
      for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random() * 255; id.data[i + 1] = Math.random() * 255; id.data[i + 2] = Math.random() * 255; id.data[i + 3] = 255 }
      ctx.putImageData(id, 0, 0)
      const big: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'))
      const canWebp: boolean = await new Promise((ok) => { const t = document.createElement('canvas'); t.width = t.height = 2; t.toBlob((b) => ok(b?.type === 'image/webp'), 'image/webp', 0.8) })
      try {
        const out: Blob = await mod.shrinkImageToLimit(big, { mime: 'image/webp' })
        return { canWebp, ok: true, type: out.type, size: out.size, limit: mod.SERVER_UPLOAD_MAX_BYTES }
      } catch (e) {
        return { canWebp, ok: false, msg: (e as Error).message, limit: mod.SERVER_UPLOAD_MAX_BYTES }
      }
    })
    if (r.canWebp) {
      expect(r.ok).toBe(true)
      expect(r.type).toBe('image/webp')
      expect(r.size ?? 0).toBeLessThanOrEqual(r.limit)
    } else {
      // WebP를 못 만드는 브라우저: PNG를 슬쩍 돌려주지 않고 안내 문구로 실패한다
      expect(r.ok).toBe(false)
      expect(r.msg).toMatch(/줄이지 못/)
    }
  })

  test('끝까지 줄여도 상한을 못 맞추면 안내 문구와 함께 실패', async ({ page }) => {
    await page.goto('/dev-e2e/editors?editor=viewer')
    const msg = await page.evaluate(async () => {
      const mod = await import('/src/lib/utils/imageResize.ts')
      const c = document.createElement('canvas')
      c.width = 1500; c.height = 1500
      const ctx = c.getContext('2d')!
      const id = ctx.createImageData(c.width, c.height)
      for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random() * 255; id.data[i + 1] = Math.random() * 255; id.data[i + 2] = Math.random() * 255; id.data[i + 3] = 255 }
      ctx.putImageData(id, 0, 0)
      const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.95))
      try { await mod.shrinkImageToLimit(blob, { maxBytes: 1024 }); return 'no-error' } catch (e) { return (e as Error).message }
    })
    expect(msg).toContain('줄이지 못')
  })

  test('4MB 초과 사진은 4MB 이하·긴 변 2000px 이하로 줄고, 4MB 이하는 원본 그대로', async ({ page }) => {
    await page.goto('/dev-e2e/editors?editor=viewer')
    const r = await page.evaluate(async () => {
      const mod = await import('/src/lib/utils/imageResize.ts')
      // 잡음 가득한 5000×3600 사진(압축이 잘 안 돼 JPEG도 4MB를 넘는다)
      const c = document.createElement('canvas')
      c.width = 5000; c.height = 3600
      const ctx = c.getContext('2d')!
      const id = ctx.createImageData(c.width, c.height)
      for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random() * 255; id.data[i + 1] = Math.random() * 255; id.data[i + 2] = Math.random() * 255; id.data[i + 3] = 255 }
      ctx.putImageData(id, 0, 0)
      const big: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.95))
      const out: Blob = await mod.shrinkImageToLimit(big)
      const bmp = await createImageBitmap(out)
      const small = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' })
      const same = (await mod.shrinkImageToLimit(small)) === small
      return { bigSize: big.size, outSize: out.size, outType: out.type, w: bmp.width, h: bmp.height, same, limit: mod.SERVER_UPLOAD_MAX_BYTES }
    })
    expect(r.bigSize).toBeGreaterThan(r.limit) // 줄이기 전에는 정말 4MB 초과
    expect(r.outSize).toBeLessThanOrEqual(r.limit)
    expect(r.outType).toBe('image/jpeg')
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(2000)
    expect(r.same).toBe(true)
  })

  test('읽을 수 없는 파일은 안내 문구와 함께 실패(조용히 원본을 올리지 않는다)', async ({ page }) => {
    await page.goto('/dev-e2e/editors?editor=viewer')
    const msg = await page.evaluate(async () => {
      const mod = await import('/src/lib/utils/imageResize.ts')
      const bad = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/heic' })
      try { await mod.shrinkImageToLimit(bad); return 'no-error' } catch (e) { return (e as Error).message }
    })
    expect(msg).toContain('읽을 수 없')
  })
})
