/**
 * 편집기 이미지 도구 — 실제 Chrome·Safari 자동 검증
 * 흐름: 이미지 선택 → 모서리 점 끌기 → 정렬 → 점 표시 토글 → 더블클릭 뷰어 → 편집 저장
 * 대상: 상품설명 편집기(RichContentEditor), 계약서 문서 편집기(DocEditor 어댑터)
 */
import { test, expect, type Page } from '@playwright/test'

const URL_RICH = '/dev-e2e/editors?editor=rich'
const URL_DOC = '/dev-e2e/editors?editor=doc'

async function open(page: Page, url: string, ready: string) {
  await page.goto(url)
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator(`${ready} img`).first().waitFor({ state: 'visible' })
}

async function widthOf(page: Page, sel: string) {
  return (await page.locator(sel).first().boundingBox())!.width
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
}

async function center(page: Page, sel: string) {
  const b = (await page.locator(sel).first().boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}

test.describe('상품설명 편집기(RichContentEditor)', () => {
  const IMG = '.rc-host .ProseMirror .rc-fig img'

  test('선택 → 점 끌기로 크기 변경 → 정렬에 맞는 점만 표시', async ({ page }) => {
    await open(page, URL_RICH, '.rc-host .ProseMirror')
    const c = await center(page, IMG)
    await page.mouse.click(c.x, c.y) // 첫 클릭은 편집기 포커스
    await page.mouse.click(c.x, c.y) // 둘째 클릭에서 이미지 선택
    await expect(page.locator('.rc-resize')).toHaveCount(4)

    const before = await widthOf(page, IMG)
    const se = (await page.locator('.rc-resize-se').boundingBox())!
    await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x - 120, y: se.y + se.height / 2 })
    await expect.poll(() => widthOf(page, IMG)).toBeLessThan(before - 40)

    // 왼쪽 정렬 → 오른쪽 모서리 2개만
    await page.getByRole('button', { name: '왼쪽 정렬' }).first().click()
    await expect(page.locator('.rc-resize-ne, .rc-resize-se')).toHaveCount(2)
    await expect(page.locator('.rc-resize-nw, .rc-resize-sw')).toHaveCount(0)
    // 오른쪽 정렬 → 왼쪽 모서리 2개만
    await page.getByRole('button', { name: '오른쪽 정렬' }).first().click()
    await expect(page.locator('.rc-resize-nw, .rc-resize-sw')).toHaveCount(2)
    await expect(page.locator('.rc-resize-ne, .rc-resize-se')).toHaveCount(0)
  })

  test('도구줄 크기 아이콘으로 점 숨기기·보이기, 새로고침 후에도 기억', async ({ page }) => {
    await open(page, URL_RICH, '.rc-host .ProseMirror')
    const c = await center(page, IMG)
    await page.mouse.click(c.x, c.y)
    await page.mouse.click(c.x, c.y)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    const toggle = page.getByRole('button', { name: '크기 조절 점 표시/숨김' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect(page.locator('.rc-resize')).toHaveCount(0)
    await page.reload()
    await page.locator(IMG).first().waitFor({ state: 'visible' })
    const c2 = await center(page, IMG)
    await page.mouse.click(c2.x, c2.y)
    await page.mouse.click(c2.x, c2.y)
    const toggle2 = page.getByRole('button', { name: '크기 조절 점 표시/숨김' })
    await expect(toggle2).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.rc-resize')).toHaveCount(0)
    await toggle2.click()
    await expect(page.locator('.rc-resize')).toHaveCount(4)
  })

  test('2장 묶음: 점이 화면 안에 있고 끌면 묶음 전체가 함께 바뀐다', async ({ page }) => {
    await open(page, URL_RICH + '&n=2', '.rc-host .ProseMirror')
    await page.setViewportSize({ width: 1200, height: 500 }) // 묶음이 화면보다 높은 상황
    const c = await center(page, IMG)
    await page.mouse.click(c.x, c.y)
    await page.mouse.click(c.x, c.y)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    const vh = page.viewportSize()!.height
    for (const id of ['nw', 'ne', 'sw', 'se']) {
      const b = (await page.locator(`.rc-resize-${id}`).boundingBox())!
      expect(b.y).toBeGreaterThan(0)
      expect(b.y + b.height).toBeLessThan(vh)
    }
    await expect(page.locator('.rc-resize-badge')).toHaveCount(0)
    const w0 = await widthOf(page, '.rc-host .ProseMirror .rc-fig')
    const se = (await page.locator('.rc-resize-se').boundingBox())!
    await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x - 150, y: se.y + se.height / 2 })
    await expect.poll(() => widthOf(page, '.rc-host .ProseMirror .rc-fig')).toBeLessThan(w0 - 40)
    const figs = page.locator('.rc-host .ProseMirror .rc-fig')
    const a = (await figs.nth(0).boundingBox())!.width
    const b = (await figs.nth(1).boundingBox())!.width
    expect(Math.abs(a - b)).toBeLessThan(2) // 묶음 전체가 같은 폭
  })

  test('폭 100% 2장 묶음이 가로로 화면 밖에 걸려도 점이 화면 안에 있고, 끌면 묶음 전체 폭이 줄어든다', async ({ page }) => {
    await page.setViewportSize({ width: 1071, height: 955 })
    await open(page, URL_RICH + '&n=2', '.rc-host .ProseMirror')
    await page.addStyleTag({ content: 'body{min-width:1280px}' }) // CMS처럼 화면보다 넓은 페이지
    await page.evaluate(() => window.scrollTo(188, 0))
    const c = await center(page, IMG)
    await page.mouse.click(c.x, 400)
    await page.mouse.click(c.x, 400)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    const vw = page.viewportSize()!.width
    for (const id of ['nw', 'ne', 'sw', 'se']) {
      const b = (await page.locator(`.rc-resize-${id}`).boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(vw)
    }
    const w0 = await widthOf(page, '.rc-host .ProseMirror .rc-fig')
    const se = (await page.locator('.rc-resize-se').boundingBox())!
    await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x - 200, y: se.y + se.height / 2 })
    await expect.poll(() => widthOf(page, '.rc-host .ProseMirror .rc-fig')).toBeLessThan(w0 - 60)
    await expect(page.locator('.rc-host .ProseMirror .rc-images')).not.toHaveAttribute('data-width', '100')
  })

  test('이미지 더블클릭 → 공통 뷰어 열림, 편집 모드 진입, 닫기', async ({ page }) => {
    await open(page, URL_RICH, '.rc-host .ProseMirror')
    const c = await center(page, IMG)
    await page.mouse.dblclick(c.x, c.y)
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: '이미지 편집' }).click()
    await expect(dlg.getByRole('toolbar', { name: '이미지 편집 도구' })).toBeVisible()
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(dlg).toHaveCount(0)
  })
})

test.describe('상품설명·크레이지로그 편집기 — 사진 업로드 자동 줄임', () => {
  test('9MB 가까운 큰 사진을 고르면 줄여서 올린다(서버로 가는 파일은 모두 4MB 이하, 문서에 사진이 들어간다)', async ({ page }) => {
    const sent: { thumb: number; large: number; type: string | null }[] = []
    await page.route('**/api/cms/upload', async (route) => {
      const body = route.request().postDataBuffer()?.length ?? 0
      sent.push({ thumb: 0, large: body, type: null })
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ largeUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#3B2F8A"/></svg>') }) })
    })
    await page.goto(URL_RICH)
    await page.locator('.rc-host .ProseMirror').waitFor()
    // 압축이 안 되는 잡음 사진을 만든다(JPEG 약 9MB — 10MB 원본 검사는 통과, 4MB 서버 상한은 초과)
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 2600; c.height = 1900
      const ctx = c.getContext('2d')!
      const id = ctx.createImageData(c.width, c.height)
      for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random() * 255; id.data[i + 1] = Math.random() * 255; id.data[i + 2] = Math.random() * 255; id.data[i + 3] = 255 }
      ctx.putImageData(id, 0, 0)
      const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.97))
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return btoa(bin)
    })
    const buffer = Buffer.from(b64, 'base64')
    expect(buffer.length).toBeGreaterThan(4 * 1024 * 1024) // 서버 상한(4MB)보다 큰 원본인지 확인(줄이지 않으면 거절될 크기)
    expect(buffer.length).toBeLessThan(10 * 1024 * 1024)
    await page.locator('.rc-root input[type=file]').first().setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer })
    await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(1)
    expect(sent[0].large).toBeLessThan(4 * 1024 * 1024) // 요청 전체(thumb+large)가 4MB 미만이면 각 파일도 4MB 이하
    expect(sent[0].large).toBeLessThan(buffer.length) // 원본보다 작게 줄어서 전송
    await expect(page.locator('.rc-host .ProseMirror .rc-fig img')).toHaveCount(2) // 기본 1장 + 새 사진 1장(문서에 삽입됨)
  })
})

test.describe('계약서 문서 편집기(DocEditor)', () => {
  const IMG = '.ProseMirror img'

  test('선택 → 점 끌기로 크기 변경 → 점 토글', async ({ page }) => {
    await open(page, URL_DOC, '.ProseMirror')
    const c = await center(page, IMG)
    await page.mouse.click(c.x, c.y)
    await expect(page.locator('[data-de-resize]:visible')).toHaveCount(4)
    const before = await widthOf(page, IMG)
    const se = (await page.locator('[data-de-resize="se"]').boundingBox())!
    await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x + 80, y: se.y + se.height / 2 })
    await expect.poll(() => widthOf(page, IMG)).toBeGreaterThan(before + 20)

    const toggle = page.getByRole('button', { name: '크기 조절 점 표시/숨김' })
    await toggle.click()
    await expect(page.locator('[data-de-resize]:visible')).toHaveCount(0)
    await toggle.click()
    await expect(page.locator('[data-de-resize]:visible')).toHaveCount(4)
  })

  test('더블클릭 → 뷰어 편집(회전) 저장이 문서 이미지에 반영된다', async ({ page }) => {
    await open(page, URL_DOC, '.ProseMirror')
    const before = await page.locator(IMG).first().getAttribute('src')
    const c = await center(page, IMG)
    await page.mouse.dblclick(c.x, c.y)
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: '이미지 편집' }).click()
    await dlg.getByRole('button', { name: '회전', exact: true }).filter({ has: page.locator('.mv-acc-head, span') }).first().click() // 아코디언 '회전' 펼치기
    await dlg.getByRole('button', { name: '오른쪽으로 회전' }).click()
    await dlg.getByRole('button', { name: '적용' }).first().click()
    await expect.poll(async () => page.locator(IMG).first().getAttribute('src')).not.toBe(before)
    expect(await page.locator(IMG).first().getAttribute('src')).toMatch(/^data:image\//)
  })
})
