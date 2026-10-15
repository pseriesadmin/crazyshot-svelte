/**
 * hwpxImport — .hwp / .hwpx → HTML 임포트 (hwp-convert 연결)
 * .hwp 이진 샘플은 저장소에 두지 않는다(실문서 개인정보 우려) — .hwp 는 오류 매핑만, 변환 성공 경로는 같은 HWPX 리더를 쓰는 .hwpx 로 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { htmlToHwpx } from 'hwp-convert'
import { importHwpx, importHwp } from '$lib/utils/docImport/hwpxImport'

function fileOf(bytes: Uint8Array, name: string): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name)
}

describe('importHwpx', () => {
  it('HWPX를 HTML로 변환한다(표·병합·굵게·본문 보존, 특수문자 이스케이프)', async () => {
    const bytes = await htmlToHwpx(
      '<h1>제목</h1><p>본문 <b>굵게</b> &lt;script&gt;</p><table border="1"><tr><td colspan="2">병합</td></tr><tr><td>a</td><td>b</td></tr></table>',
    )
    const { html, warnings } = await importHwpx(fileOf(bytes, 'a.hwpx'))
    expect(html).toContain('제목')
    expect(html).toContain('<strong>')
    expect(html).toContain('colspan="2"')
    expect(html).toContain('<table')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script')
    expect(warnings.length).toBe(1)
  })

  it('zip이 아닌 파일은 이유가 담긴 한글 오류를 던진다', async () => {
    await expect(importHwpx(fileOf(new Uint8Array([1, 2, 3, 4]), 'bad.hwpx'))).rejects.toThrow('한글 문서 형식이 아니거나')
  })
})

describe('importHwp', () => {
  it('HWP 5.0 시그니처가 아닌 파일은 이유가 담긴 한글 오류를 던진다', async () => {
    await expect(importHwp(fileOf(new Uint8Array([1, 2, 3, 4]), 'bad.hwp'))).rejects.toThrow('한글 문서 형식이 아니거나')
  })
  it('빈 파일도 오류로 처리한다', async () => {
    await expect(importHwp(fileOf(new Uint8Array(0), 'empty.hwp'))).rejects.toThrow()
  })
})
