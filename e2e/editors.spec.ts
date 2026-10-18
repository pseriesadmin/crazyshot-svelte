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

  test('안쪽 여백이 있는 스크롤 상자 안에서도 서식 도구줄이 스크롤 영역 맨 위에 딱 붙는다(위 틈 없음)', async ({ page }) => {
    await page.goto(URL_RICH + '&n=2&scroll=1')
    await page.locator('.rc-host .ProseMirror .rc-fig img').first().waitFor()
    const box = page.locator('#e2e-scroller')
    const wrap = page.locator('.rc-toolbar-wrap')
    const topOf = async (loc: typeof box) => (await loc.boundingBox())!.y
    // 스크롤 전: 여백 20px 아래에 도구줄(원래 위치)
    expect(Math.round((await topOf(wrap)) - (await topOf(box)))).toBe(20)
    await box.evaluate((el) => { el.scrollTop = 400 })
    await expect.poll(async () => Math.round((await topOf(wrap)) - (await topOf(box)))).toBe(0) // 스크롤 영역 맨 위에 붙음
    // 도구줄 위쪽 경계 바로 위(스크롤 영역 맨 위 1px)에 편집 내용이 비치지 않는다 = 그 지점의 맨 앞 요소가 도구줄
    const hit = await page.evaluate(() => {
      const b = document.querySelector('#e2e-scroller')!.getBoundingClientRect()
      const el = document.elementFromPoint(b.x + 200, b.y + 2)
      return !!el?.closest('.rc-toolbar-wrap')
    })
    expect(hit).toBe(true)
  })

  test('아래쪽 끝 손잡이를 끌어 편집 영역을 넓히고, 방향키·더블클릭으로 조절·복귀', async ({ page }) => {
    await open(page, URL_RICH, '.rc-host .ProseMirror')
    const wrap = page.locator('.rc-canvas-wrap')
    const grip = page.getByRole('separator', { name: /편집 영역 높이 조절/ })
    await expect(grip).toBeVisible()
    const h0 = (await wrap.boundingBox())!.height
    await grip.evaluate((el) => el.scrollIntoView({ block: 'center' })) // 고정 도구줄에 가려지지 않고, 끌 위치까지 화면 안에 있게(화면 가운데)
    const g = (await grip.boundingBox())!
    await drag(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 }, { x: g.x + g.width / 2, y: g.y + g.height / 2 + 300 })
    await expect.poll(async () => Math.round((await wrap.boundingBox())!.height - h0)).toBe(300) // 끈 만큼 정확히 넓어짐
    // 방향키: 아래 +40
    await grip.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => Math.round((await wrap.boundingBox())!.height - h0)).toBe(340)
    // 더블클릭: 기본 높이(내용이 더 길면 내용 높이)로 복귀
    await grip.dblclick()
    await expect.poll(async () => Math.round((await wrap.boundingBox())!.height)).toBeLessThanOrEqual(Math.round(h0) + 1)
    // 편집 영역이 넓어져도 편집기는 정상 동작(글 입력)
    await page.locator('.rc-host .ProseMirror p').first().click()
    await page.keyboard.type('ok')
    await expect(page.locator('.rc-host .ProseMirror')).toContainText('ok')
  })

  test('이미지가 스크롤 상자보다 커도 네 점이 모두 상자 안에서 눌리고, 아래쪽 점으로도 크기가 조절된다', async ({ page }) => {
    await page.goto(URL_RICH + '&n=1&scroll=1') // 600px 스크롤 상자 안에 높이 800px 넘는 이미지
    await page.locator('.rc-host .ProseMirror .rc-fig img').first().waitFor()
    const c = await center(page, IMG)
    await page.mouse.click(c.x, c.y)
    await page.mouse.click(c.x, c.y)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    // 네 점 모두 "그 위치를 실제로 누르면 점이 눌린다"(다른 요소·상자 밖에 가려지지 않는다)
    const blocked = await page.evaluate(() => {
      const sc = document.querySelector('#e2e-scroller')!.getBoundingClientRect()
      return [...document.querySelectorAll('.rc-resize')].filter((e) => {
        const r = e.getBoundingClientRect()
        const x = r.x + r.width / 2, y = r.y + r.height / 2
        const inside = y >= sc.top && y <= sc.bottom && x >= sc.left && x <= sc.right
        return !inside || document.elementFromPoint(x, y) !== e
      }).map((e) => e.className)
    })
    expect(blocked).toEqual([])
    // 아래쪽 점(se)을 끌어 줄이기
    const w0 = await widthOf(page, '.rc-host .ProseMirror .rc-fig')
    const se = (await page.locator('.rc-resize-se').boundingBox())!
    await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x - 200, y: se.y + se.height / 2 })
    await expect.poll(() => widthOf(page, '.rc-host .ProseMirror .rc-fig')).toBeLessThan(w0 - 60)
    // 줄인 뒤에도 네 점이 그대로 남아 있고, 한 번 더 조절된다(반복 조작)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    const w1 = await widthOf(page, '.rc-host .ProseMirror .rc-fig')
    const ne = (await page.locator('.rc-resize-ne').boundingBox())!
    await drag(page, { x: ne.x + ne.width / 2, y: ne.y + ne.height / 2 }, { x: ne.x + 80, y: ne.y + ne.height / 2 })
    await expect.poll(() => widthOf(page, '.rc-host .ProseMirror .rc-fig')).toBeGreaterThan(w1 + 40)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
  })

  test('스크롤 상자를 맨 아래까지 내린 채 큰 이미지를 크게 줄여도 점이 사라지지 않고, 끌기가 끝나 폭이 저장되며, 다시 조절된다', async ({ page }) => {
    await page.goto(URL_RICH + '&n=1&scroll=1')
    await page.locator('.rc-host .ProseMirror .rc-fig img').first().waitFor()
    const box = page.locator('#e2e-scroller')
    await box.evaluate((el) => { (el as HTMLElement).style.height = '400px' }) // 이미지(높이 800px대)보다 한참 낮은 스크롤 상자
    const top = (await page.locator(IMG).first().boundingBox())!
    await page.mouse.click(top.x + top.width / 2, top.y + 60) // 상자 안에 보이는 이미지 윗부분을 누른다
    await page.mouse.click(top.x + top.width / 2, top.y + 60)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    await box.evaluate((el) => { el.scrollTop = el.scrollHeight }) // 맨 아래까지
    await expect.poll(async () => page.locator('.rc-resize').count()).toBe(4)
    // 스크롤 직후 점 위치가 자리 잡을 때까지(점이 실제로 눌리는 위치에 올 때까지) 기다린다
    await expect.poll(() => page.evaluate(() => {
      const e = document.querySelector('.rc-resize-se')
      if (!e) return false
      const r = e.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e
    })).toBe(true)
    const se = (await page.locator('.rc-resize-se').boundingBox())!
    // 빠르게 크게 줄이는 한 번의 끌기(한 번에 20%까지 — 줄이는 순간 묶음이 짧아져 위로 밀려나는 구간을 지난다. 천천히 끌 때는 결함이 드러나지 않았다)
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2)
    await page.mouse.down()
    await page.mouse.move(se.x - 600, se.y + se.height / 2, { steps: 1 })
    await page.mouse.up()
    // 끝났으면: 점 4개 유지 + 폭이 문서에 저장(data-width 변경) + 인라인 임시 폭이 남지 않음
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    await expect(page.locator('.rc-host .ProseMirror .rc-images')).not.toHaveAttribute('data-width', '100')
    const inlineLeft = await page.locator('.rc-host .ProseMirror .rc-images').evaluate((el) => (el as HTMLElement).style.width)
    const dw = await page.locator('.rc-host .ProseMirror .rc-images').getAttribute('data-width')
    expect(inlineLeft === '' || inlineLeft === `${dw}%`).toBe(true)
    // 다시 선택하지 않아도 다시 조절된다(점이 영구적으로 사라지는 상태가 아님)
    const w1 = await widthOf(page, '.rc-host .ProseMirror .rc-fig')
    const nw = (await page.locator('.rc-resize-nw').boundingBox())!
    await drag(page, { x: nw.x + nw.width / 2, y: nw.y + nw.height / 2 }, { x: nw.x - 80, y: nw.y + nw.height / 2 })
    await expect.poll(() => widthOf(page, '.rc-host .ProseMirror .rc-fig')).toBeGreaterThan(w1 + 40)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
  })

  test('가로로 화면보다 넓은 페이지 + 스크롤 상자 맨 아래에서 빠르게 줄여도 점이 사라지지 않고 폭이 저장된다', async ({ page }) => {
    await page.goto(URL_RICH + '&n=1&scroll=1')
    await page.locator('.rc-host .ProseMirror .rc-fig img').first().waitFor()
    await page.addStyleTag({ content: 'body{min-width:1600px}' })
    const box = page.locator('#e2e-scroller')
    await box.evaluate((el) => { (el as HTMLElement).style.height = '400px' })
    const top = (await page.locator(IMG).first().boundingBox())!
    await page.mouse.click(top.x + top.width / 2, top.y + 60)
    await page.mouse.click(top.x + top.width / 2, top.y + 60)
    await box.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => page.evaluate(() => {
      const e = document.querySelector('.rc-resize-se')
      if (!e) return false
      const r = e.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e
    })).toBe(true)
    const se = (await page.locator('.rc-resize-se').boundingBox())!
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2)
    await page.mouse.down()
    await page.mouse.move(se.x - 300, se.y + se.height / 2, { steps: 1 })
    await page.mouse.up()
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    await expect(page.locator('.rc-host .ProseMirror .rc-images')).not.toHaveAttribute('data-width', '100')
  })

  test('조절 점은 이미지의 실제 네 모서리에 놓이고, 이미지 도구줄은 큰/작은 이미지 모두에서 점을 가리지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await open(page, URL_RICH + '&n=1', '.rc-host .ProseMirror')
    const checkAll = async (label: string, expectCorners: boolean) => {
      await expect(page.locator('.rc-resize')).toHaveCount(4)
      const r = await page.evaluate(() => {
        const g = document.querySelector('.rc-images')!.getBoundingClientRect()
        const bar = document.querySelector('.rc-ctx')!.getBoundingClientRect()
        const hs = [...document.querySelectorAll('.rc-resize')].map((e) => { const q = e.getBoundingClientRect(); return { id: e.className.split(' ')[1], cx: q.x + q.width / 2, cy: q.y + q.height / 2, l: q.left, r: q.right, t: q.top, b: q.bottom } })
        return { g: { l: g.left, r: g.right, t: g.top, b: g.bottom }, bar: { l: bar.left, r: bar.right, t: bar.top, b: bar.bottom }, hs }
      })
      // 도구줄이 점을 가리지 않는다(사각형 겹침 없음)
      for (const h of r.hs) {
        const overlap = h.l < r.bar.r && r.bar.l < h.r && h.t < r.bar.b && r.bar.t < h.b
        expect(overlap, `${label}: 도구줄이 ${h.id} 점을 가림 (bar ${JSON.stringify(r.bar)} / 점 ${JSON.stringify(h)})`).toBe(false)
      }
      if (expectCorners) {
        // 점 = 이미지의 실제 모서리(위·아래, 좌·우) — 도구줄 때문에 옆면 중간으로 밀리지 않는다
        for (const h of r.hs) {
          expect(Math.abs(h.cy - (h.id.includes('n') ? r.g.t : r.g.b)), `${label}: ${h.id} 세로 위치`).toBeLessThanOrEqual(1.5)
        }
      }
      return r
    }
    const c = await center(page, IMG)
    await page.mouse.click(c.x, c.y)
    await page.mouse.click(c.x, c.y)
    // 작은 이미지로 줄인다(폭 약 25%) — 이미지 전체가 화면에 보이는 크기
    for (let i = 0; i < 3; i++) {
      const se = (await page.locator('.rc-resize-se').boundingBox())!
      await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x - 330, y: se.y + se.height / 2 }, 3)
    }
    await expect.poll(async () => Number(await page.locator('.rc-host .ProseMirror .rc-images').getAttribute('data-width'))).toBeLessThan(40)
    await page.locator('.rc-host .ProseMirror .rc-images').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await expect.poll(() => page.evaluate(() => { const g = document.querySelector('.rc-images')!.getBoundingClientRect(); return g.top > 150 && g.bottom < innerHeight - 100 })).toBe(true)
    const small = await checkAll('작은 이미지', true)
    expect(small.g.b - small.g.t).toBeLessThan(400)
    // 작은 이미지: 도구줄이 이미지 안쪽이 아니라 바깥(위 또는 아래)에 있다
    expect(small.bar.b <= small.g.t || small.bar.t >= small.g.b).toBe(true)
    // 큰 이미지(폭 100%)로 되돌린 뒤에도: 점이 모서리(보이는 범위 안)에 있고 도구줄이 점을 가리지 않는다
    const ne = (await page.locator('.rc-resize-ne').boundingBox())!
    await drag(page, { x: ne.x + ne.width / 2, y: ne.y + ne.height / 2 }, { x: ne.x + 900, y: ne.y + ne.height / 2 }, 4)
    await expect.poll(async () => Number(await page.locator('.rc-host .ProseMirror .rc-images').getAttribute('data-width'))).toBeGreaterThan(80)
    await checkAll('큰 이미지', false)
  })

  for (const [vw, vh, scroll] of [[1000, 800, false], [1280, 900, false], [1280, 900, true]] as const) {
    test(`오른쪽 정렬한 작은 이미지 묶음에서도 이미지 도구줄이 화면(·스크롤 상자) 가로 안에 있다 — 창 ${vw}px${scroll ? ' + 스크롤 상자' : ''}`, async ({ page }) => {
      await page.setViewportSize({ width: vw, height: vh })
      await open(page, URL_RICH + '&n=2' + (scroll ? '&scroll=1' : ''), '.rc-host .ProseMirror')
      const c = await center(page, IMG)
      await page.mouse.click(c.x, c.y)
      await page.mouse.click(c.x, c.y)
      await expect(page.locator('.rc-resize')).toHaveCount(4)
      for (let i = 0; i < 3; i++) { // 폭 약 20~25%로 줄이기
        const se = (await page.locator('.rc-resize-se').boundingBox())!
        await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x - 300, y: se.y + se.height / 2 }, 3)
      }
      await expect.poll(async () => Number(await page.locator('.rc-host .ProseMirror .rc-images').getAttribute('data-width'))).toBeLessThan(40)
      await page.getByRole('button', { name: '오른쪽 정렬' }).first().click()
      await expect(page.locator('.rc-host .ProseMirror .rc-images')).toHaveAttribute('data-align', 'right')
      await page.locator('.rc-host .ProseMirror .rc-images').evaluate((el) => el.scrollIntoView({ block: 'center' }))
      // 위치가 자리 잡은 뒤 도구줄 가로 범위를 측정
      await expect.poll(async () => {
        const r = await page.evaluate(() => {
          const bar = document.querySelector('.rc-ctx')!.getBoundingClientRect()
          const sc = document.querySelector('#e2e-scroller')!.getBoundingClientRect()
          const g = document.querySelector('.rc-images')!.getBoundingClientRect()
          const useBox = new URLSearchParams(location.search).get('scroll') === '1'
          return { l: bar.left, r: bar.right, boxL: useBox ? sc.left : 0, boxR: useBox ? sc.right : innerWidth, gl: g.left, gr: g.right }
        })
        return r.l >= r.boxL - 0.5 && r.r <= r.boxR + 0.5 && r.gl > r.boxR * 0.4 // 이미지가 실제로 오른쪽에 있는 조건에서 도구줄이 범위 안
      }, { timeout: 5000 }).toBe(true)
      // 도구줄 맨 오른쪽 버튼(묶음 삭제)이 눌린다 = 화면 밖·상자 밖에 가려지지 않았다
      const lastBtn = page.locator('.rc-ctx button').last()
      const b = (await lastBtn.boundingBox())!
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button') === document.querySelector('.rc-ctx button:last-of-type') || !!document.elementFromPoint(x, y)?.closest('.rc-ctx'), [b.x + b.width / 2, b.y + b.height / 2])
      expect(hit).toBe(true)
      expect(b.x + b.width).toBeLessThanOrEqual(vw)
    })
  }

  test('끌기를 점 밖에서 놓아도 끌기가 끝나고 점이 유지된다(손을 놓은 위치가 점이 아니어도)', async ({ page }) => {
    await open(page, URL_RICH, '.rc-host .ProseMirror')
    const c = await center(page, IMG)
    await page.mouse.click(c.x, c.y)
    await page.mouse.click(c.x, c.y)
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    const se = (await page.locator('.rc-resize-se').boundingBox())!
    await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: 20, y: 20 }, 4) // 화면 왼쪽 위 구석(점·편집기 밖)에서 놓기
    await expect(page.locator('.rc-resize')).toHaveCount(4)
    await expect(page.locator('.rc-resize-badge')).toHaveCount(0) // 끌기 표시(%) 배지가 남아 있지 않다 = 끌기가 끝났다
    const se2 = (await page.locator('.rc-resize-se').boundingBox())!
    expect(se2.x).toBeGreaterThan(0)
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
