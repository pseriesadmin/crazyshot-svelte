// @vitest-environment jsdom
/**
 * hwpxFormatting — HWPX 서식 보완(정렬·글꼴·표 너비·셀 테두리색). 합성 HWPX(htmlToHwpx)의 header.xml 을 바꿔
 * 스타일 참조가 HTML 로 옮겨지는지 확인한다. 실문서는 저장소에 두지 않는다.
 */
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { htmlToHwpx } from 'hwp-convert'
import { importHwpx } from '$lib/utils/docImport/hwpxImport'
import { applyHwpxFormatting } from '$lib/utils/docImport/hwpxFormatting'

const SAMPLE =
  '<p>첫 문단</p><p>둘째 문단</p><table border="1"><tr><td>가</td><td>나</td></tr><tr><td colspan="2">병합</td></tr></table>'

async function build(mutateHeader?: (xml: string) => string): Promise<Uint8Array> {
  const bytes = await htmlToHwpx(SAMPLE)
  if (!mutateHeader) return bytes
  const zip = await JSZip.loadAsync(bytes)
  const path = Object.keys(zip.files).find((p) => /header\.xml$/i.test(p))!
  zip.file(path, mutateHeader(await zip.file(path)!.async('string')))
  return zip.generateAsync({ type: 'uint8array' })
}
const fileOf = (b: Uint8Array) => new File([b.slice().buffer as ArrayBuffer], 'a.hwpx')

describe('applyHwpxFormatting', () => {
  it('문단 정렬(paraPr align)을 <p> style 로 옮긴다', async () => {
    const bytes = await build((x) => x.replace(/horizontal="(JUSTIFY|LEFT)"/g, 'horizontal="CENTER"'))
    const { html } = await importHwpx(fileOf(bytes))
    expect(html).toMatch(/<p[^>]*text-align:\s*center/)
    expect(html).toContain('첫 문단')
  })

  it('글꼴(charPr→fontface)을 span font-family 로 감싼다', async () => {
    const { html } = await importHwpx(fileOf(await build()))
    expect(html).toMatch(/font-family:\s*'[^']+',\s*(sans-)?serif/)
  })

  it('표 셀에 열 폭(colwidth)을 넣고 병합 셀은 span 개수만큼 쪼갠다', async () => {
    const { html } = await importHwpx(fileOf(await build()))
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const cells = Array.from(doc.querySelectorAll('td'))
    expect(cells.length).toBe(3)
    expect(cells[0]!.getAttribute('colwidth')).toMatch(/^\d+$/)
    expect(cells[2]!.getAttribute('colspan')).toBe('2')
    expect((cells[2]!.getAttribute('colwidth') ?? '').split(',').length).toBe(2)
  })

  it('셀 테두리 색(borderFill)을 border-color 로 옮긴다', async () => {
    const bytes = await build((x) => x.replace(/type="NONE" width="([^"]+)" color="#000000"/g, 'type="SOLID" width="$1" color="#FF0000"'))
    const { html } = await importHwpx(fileOf(bytes))
    expect(html.toLowerCase()).toContain('border-color:#ff0000')
  })

  it('문단·표 개수가 맞지 않으면 원본 HTML을 그대로 돌려준다', async () => {
    const bytes = await build()
    const raw = '<p>하나</p><p>둘</p><p>셋</p><p>넷</p><p>다섯</p>'
    expect(await applyHwpxFormatting(raw, bytes)).toBe(raw)
  })

  it('HWPX가 아닌 바이트는 원본을 돌려준다(오류를 던지지 않는다)', async () => {
    const raw = '<p>본문</p>'
    expect(await applyHwpxFormatting(raw, new Uint8Array([1, 2, 3]))).toBe(raw)
  })
})

describe('applyHwpxFormatting — 공백·선두 빈 문단·내어쓰기', () => {
  const NBSP = '&nbsp;' // innerHTML 직렬화 형태
  it('연속 공백(빈칸 입력란)은 nbsp로 보존한다', async () => {
    const bytes = await build()
    const out = await applyHwpxFormatting('<p><span>1. 근로개시일 :      년   월</span></p>', bytes)
    expect(out).toContain(`: ${NBSP.repeat(5)}년 ${NBSP.repeat(2)}월`)
  })
  it('공백뿐인 조각(밑줄 칸)과 문단 맨 앞 공백도 보존한다', async () => {
    const bytes = await build()
    const out = await applyHwpxFormatting('<p>  앞공백<u>   </u>끝</p>', bytes)
    expect(out).toContain(`${NBSP}${NBSP}앞공백`)
    expect(out).toContain(`<u>${NBSP.repeat(3)}</u>`)
  })
  it('문서 맨 앞의 내용 없는 문단은 지우고 중간 빈 문단은 둔다', async () => {
    const bytes = await build()
    const out = await applyHwpxFormatting('<p><span></span></p><p> </p><p>제목</p><p></p><p>본문</p>', bytes)
    expect(out.startsWith('<p>제목</p>')).toBe(true)
    expect(out).toContain('<p></p><p>본문</p>')
  })
  it('내어쓰기(intent<0) 문단은 첫 줄 시작 위치 기준으로 들여쓴다', async () => {
    const bytes = await build((x) =>
      x.replace(/<hh:margin>[\s\S]*?<\/hh:margin>/g, '<hh:margin><hh:intent value="-4000"/><hh:left value="6000"/><hh:right value="0"/><hh:prev value="0"/><hh:next value="0"/></hh:margin>'),
    )
    const { html } = await importHwpx(fileOf(bytes))
    // left 6000 + intent -4000 = 2000 HWPUNIT ≈ 글자 높이 1000 기준 2em → 1단계(2em)
    expect(html).toMatch(/padding-left:\s*2em/)
  })
})
