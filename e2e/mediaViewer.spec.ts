/**
 * 공통 이미지·문서 뷰어(MediaViewer) 하단 도구줄·조작 전수 검증 — 실제 Chrome·Safari
 * 화면: /dev-e2e/editors?editor=viewer[&kinds=mixed][&ro=1]
 */
import { test, expect, type Page } from '@playwright/test'

const URL_V = '/dev-e2e/editors?editor=viewer'
const dlg = (page: Page) => page.getByRole('dialog')
const bar = (page: Page) => dlg(page).getByRole('toolbar', { name: '뷰어 도구' })
const btn = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const img = (page: Page) => dlg(page).locator('img.mv-img')
const tf = (page: Page) => img(page).evaluate((el) => (el as HTMLElement).style.transform)
const scaleOf = async (page: Page) => Number(/scale\(([\d.]+)\)/.exec(await tf(page))![1])
const rotOf = async (page: Page) => Number(/rotate\((-?[\d.]+)deg\)/.exec(await tf(page))![1])
const counter = (page: Page) => dlg(page).locator('.mv-count')
const log = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __mv: Record<string, number> }).__mv }))

async function open(page: Page, q = '') {
  await page.goto(URL_V + q)
  await dlg(page).waitFor({ state: 'visible' })
}

test.describe('공통 뷰어 — 도구줄', () => {
  test('도구줄 구성: 썸네일·축소·확대·맞춤·회전·편집·내려받기·삭제', async ({ page }) => {
    await open(page)
    for (const n of ['썸네일 정렬', '축소', '확대', '크기 맞춤', '회전', '이미지 편집', '내려받기']) await expect(btn(page, n)).toBeVisible()
    await expect(bar(page).getByRole('button', { name: '삭제' })).toBeVisible()
    await expect(counter(page)).toHaveText('1 / 3')
  })

  test('확대·축소: 단계별 변화, 한계에서 비활성, 크기 맞춤으로 복귀', async ({ page }) => {
    await open(page)
    await expect(btn(page, '축소')).toBeEnabled() // 1배에서도 축소 가능(0.25까지)
    await expect(btn(page, '크기 맞춤')).toBeDisabled() // 초기 상태 = 이미 맞춤
    await btn(page, '확대').click()
    expect(await scaleOf(page)).toBe(1.25)
    await expect(btn(page, '크기 맞춤')).toBeEnabled()
    for (let i = 0; i < 10; i++) if (await btn(page, '확대').isEnabled()) await btn(page, '확대').click()
    expect(await scaleOf(page)).toBe(4)
    await expect(btn(page, '확대')).toBeDisabled()
    await btn(page, '크기 맞춤').click()
    expect(await scaleOf(page)).toBe(1)
    for (let i = 0; i < 10; i++) if (await btn(page, '축소').isEnabled()) await btn(page, '축소').click()
    expect(await scaleOf(page)).toBe(0.25)
    await expect(btn(page, '축소')).toBeDisabled()
  })

  test('회전: 90도씩, 4번이면 원위치, 이미지가 화면 안에 유지', async ({ page }) => {
    await open(page)
    for (const want of [90, 180, 270, 0]) {
      await btn(page, '회전').click()
      expect(await rotOf(page)).toBe(want)
      // 회전 전환 애니메이션이 끝나 위치가 안정될 때까지 기다린 뒤 측정(고정 대기 없음)
      let prev = ''
      await expect.poll(async () => {
        const cur = JSON.stringify(await img(page).boundingBox())
        const same = cur === prev
        prev = cur
        return same
      }, { intervals: [100, 100, 100, 150, 200, 250] }).toBe(true)
      const b = (await img(page).boundingBox())!
      expect(b.y).toBeGreaterThanOrEqual(72 - 1) // 상단 제목 줄 아래
      if (want === 90 || want === 270) expect(b.height).toBeGreaterThan(b.width) // 세로로 돌아간 모양
      const vp = page.viewportSize()!
      expect(b.x).toBeGreaterThanOrEqual(-1)
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1)
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height - 80 + 1) // 하단 도구줄 위
    }
  })

  test('휠 확대·축소와 확대 상태에서 끌어 이동', async ({ page }) => {
    await open(page)
    const c = (await img(page).boundingBox())!
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
    await page.mouse.wheel(0, -120)
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(1)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => scaleOf(page)).toBe(1)
    await btn(page, '확대').click()
    await btn(page, '확대').click()
    const b = (await img(page).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 30, { steps: 5 })
    await page.mouse.up()
    expect(await tf(page)).toMatch(/translate\(60px, 30px\)/)
    await btn(page, '크기 맞춤').click()
    expect(await tf(page)).toMatch(/translate\(0px(, 0px)?\)/) // Safari는 translate(0px)로 직렬화
  })

  test('썸네일 정렬: 전체 나열, 토글 상태, 선택하면 그 이미지로 이동', async ({ page }) => {
    await open(page)
    await btn(page, '썸네일 정렬').click()
    await expect(btn(page, '썸네일 정렬')).toHaveAttribute('aria-pressed', 'true')
    await expect(dlg(page).locator('.mv-thumb')).toHaveCount(3)
    for (const n of ['확대', '축소', '회전', '이미지 편집', '내려받기']) await expect(btn(page, n)).toBeDisabled()
    await dlg(page).locator('.mv-thumb').nth(2).click()
    await expect(counter(page)).toHaveText('3 / 3')
    await expect(img(page)).toBeVisible()
    await btn(page, '썸네일 정렬').click()
    await btn(page, '썸네일 정렬').click()
    await expect(btn(page, '썸네일 정렬')).toHaveAttribute('aria-pressed', 'false')
  })

  test('이전/다음(순환)과 키보드 단축키(←→ + - R 0), 이동 시 보기 상태 초기화', async ({ page }) => {
    await open(page)
    await dlg(page).getByRole('button', { name: '다음' }).click()
    await expect(counter(page)).toHaveText('2 / 3')
    await dlg(page).getByRole('button', { name: '이전' }).click()
    await dlg(page).getByRole('button', { name: '이전' }).click()
    await expect(counter(page)).toHaveText('3 / 3') // 처음에서 이전 → 마지막
    await page.keyboard.press('ArrowRight')
    await expect(counter(page)).toHaveText('1 / 3')
    await page.keyboard.press('+')
    expect(await scaleOf(page)).toBe(1.25)
    await page.keyboard.press('r')
    expect(await rotOf(page)).toBe(90)
    await page.keyboard.press('ArrowLeft') // 다른 이미지로 가면 확대·회전 초기화
    await expect(counter(page)).toHaveText('3 / 3')
    expect(await scaleOf(page)).toBe(1)
    expect(await rotOf(page)).toBe(0)
    await page.keyboard.press('=')
    await page.keyboard.press('-')
    expect(await scaleOf(page)).toBe(1)
    await page.keyboard.press('+')
    await page.keyboard.press('0')
    expect(await scaleOf(page)).toBe(1)
  })

  test('입력창에 포커스가 있으면 단축키(+ r)가 글자 입력을 가로채지 않는다', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      const i = document.createElement('input')
      i.id = 'bg-input'
      document.body.appendChild(i)
      i.focus()
    })
    await page.keyboard.type('+r')
    expect(await scaleOf(page)).toBe(1)
    expect(await rotOf(page)).toBe(0)
    await expect(page.locator('#bg-input')).toHaveValue('+r')
  })

  test('내려받기: 파일이 실제로 저장된다', async ({ page }) => {
    await open(page)
    const [d] = await Promise.all([page.waitForEvent('download'), btn(page, '내려받기').click()])
    expect(d.suggestedFilename().normalize('NFC')).toMatch(/^첫째/) // Safari는 한글 파일명을 분해형(NFD)으로 돌려준다
  })

  test('삭제: 첫 클릭은 경고(실행 안 됨), 두 번째 클릭에서 삭제되고 다음 장으로, 마지막이면 닫힘', async ({ page }) => {
    await open(page)
    const del = bar(page).getByRole('button', { name: '삭제' })
    await del.click()
    expect((await log(page)).deletes).toBe(0)
    await del.click()
    await expect.poll(async () => (await log(page)).deletes).toBe(1)
    await expect(counter(page)).toHaveText('1 / 2')
    for (let i = 0; i < 2; i++) {
      await bar(page).getByRole('button', { name: '삭제' }).click()
      await bar(page).getByRole('button', { name: '삭제' }).click()
      await expect.poll(async () => (await log(page)).deletes).toBe(2 + i)
    }
    await expect(dlg(page)).toHaveCount(0)
    expect((await log(page)).closed).toBe(1)
  })

  test('편집: 진입 → 취소(저장 없음) → 다시 진입 → 적용(저장 1회, 편집 모드 종료), 편집 중 이동·단축키 잠금', async ({ page }) => {
    await open(page)
    await btn(page, '이미지 편집').click()
    const edit = dlg(page).getByRole('toolbar', { name: '이미지 편집 도구' })
    await expect(edit).toBeVisible()
    await page.keyboard.press('ArrowRight') // 편집 중에는 이동 안 됨
    await expect(counter(page)).toHaveText('1 / 3')
    await edit.getByRole('button', { name: '취소' }).click()
    await expect(edit).toHaveCount(0)
    expect((await log(page)).saves).toBe(0)
    await btn(page, '이미지 편집').click()
    await edit.getByRole('button', { name: '자르기' }).waitFor()
    await edit.getByRole('button', { name: '회전', exact: true }).click()
    await edit.getByRole('button', { name: '오른쪽으로 회전' }).click()
    await edit.getByRole('button', { name: '적용' }).click()
    await expect.poll(async () => (await log(page)).saves).toBe(1)
    await expect(edit).toHaveCount(0)
    await expect(dlg(page)).toBeVisible() // 저장 후 뷰어는 계속 열려 있음
  })

  test('Esc 순서: 편집 종료 → 썸네일 닫기 → 뷰어 닫기 / 배경 클릭·✕ 로 닫기', async ({ page }) => {
    await open(page)
    await btn(page, '이미지 편집').click()
    await dlg(page).getByRole('toolbar', { name: '이미지 편집 도구' }).waitFor()
    await page.keyboard.press('Escape')
    await expect(dlg(page).getByRole('toolbar', { name: '이미지 편집 도구' })).toHaveCount(0)
    await expect(dlg(page)).toBeVisible()
    await btn(page, '썸네일 정렬').click()
    await page.keyboard.press('Escape')
    await expect(btn(page, '썸네일 정렬')).toHaveAttribute('aria-pressed', 'false')
    await expect(dlg(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toHaveCount(0)
    await page.getByRole('button', { name: '뷰어 열기' }).click()
    await dlg(page).getByRole('button', { name: '닫기' }).click()
    await expect(dlg(page)).toHaveCount(0)
    await page.getByRole('button', { name: '뷰어 열기' }).click()
    await page.mouse.click(5, 300) // 배경(가장자리)
    await expect(dlg(page)).toHaveCount(0)
  })

  test('읽기 전용(삭제·편집 함수 없음): 삭제·편집 버튼 숨김, 나머지는 동작', async ({ page }) => {
    await open(page, '&ro=1')
    await expect(bar(page).getByRole('button', { name: '삭제' })).toHaveCount(0)
    await expect(btn(page, '이미지 편집')).toHaveCount(0)
    for (const n of ['썸네일 정렬', '확대', '회전', '내려받기']) await expect(btn(page, n)).toBeVisible()
  })

  test('이미지가 아닌 항목(PDF·영상)에서는 이미지 전용 도구가 숨겨지고 썸네일 정렬만 남는다', async ({ page }) => {
    await open(page, '&kinds=mixed')
    await expect(counter(page)).toHaveText('1 / 3')
    await dlg(page).getByRole('button', { name: '다음' }).click() // PDF
    for (const n of ['확대', '축소', '회전', '이미지 편집', '내려받기', '크기 맞춤']) await expect(btn(page, n)).toHaveCount(0)
    await expect(btn(page, '썸네일 정렬')).toBeVisible()
    await dlg(page).getByRole('button', { name: '다음' }).click() // 영상
    await expect(dlg(page).locator('iframe.mv-video')).toHaveAttribute('src', /youtube\.com\/embed\/dQw4w9WgXcQ/)
    await expect(btn(page, '회전')).toHaveCount(0)
    await btn(page, '썸네일 정렬').click()
    await expect(dlg(page).locator('.mv-thumb')).toHaveCount(3)
    await expect(dlg(page).locator('.mv-thumb-pdf')).toHaveCount(1)
    await expect(dlg(page).locator('.mv-thumb-play')).toHaveCount(1)
    await dlg(page).locator('.mv-thumb').nth(0).click()
    await expect(btn(page, '회전')).toBeVisible() // 이미지로 돌아오면 도구 복귀
  })
})
