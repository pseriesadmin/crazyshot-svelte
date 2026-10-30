/**
 * docxFromHtml.ts — HTML → Word 문서(.docx) (docx 9.15.0 + docx/html)
 *
 * 선택 근거(2026-10-29 시험, 실제 기본 계약서 HTML): docx/html 은 표 10/10·칸 합침·글자 크기·색·정렬·배경·표 테두리를 담았고
 * `<style>` 클래스 CSS도 스스로 풀어 읽는다(HTML형 양식에 인라인화 불필요). 비교한 html-to-docx 는 같은 입력에서 오류로 실패했다.
 * 라이브러리는 필요할 때만 불러온다(동적 import, 압축 후 약 360KB).
 *
 * 한글 글꼴: Word 기본 글꼴이 한글을 못 그리는 경우를 막기 위해 기본 글꼴을 맑은 고딕으로 지정한다.
 */
import type { Document as DocxDocument } from 'docx'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function buildDocument(html: string, title: string): Promise<DocxDocument> {
  const [{ Document }, { htmlToContent }] = await Promise.all([import('docx'), import('docx/html')])
  const children = await htmlToContent(html, {})
  return new Document({
    title: title || '계약서 양식',
    creator: '크레이지샷',
    styles: {
      default: {
        document: { run: { font: { ascii: 'Malgun Gothic', hAnsi: 'Malgun Gothic', eastAsia: '맑은 고딕' }, size: 21 } },
      },
    },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  })
}

/** 브라우저에서 내려받을 Blob */
export async function htmlToDocxBlob(html: string, title: string): Promise<Blob> {
  const { Packer } = await import('docx')
  return Packer.toBlob(await buildDocument(html, title))
}

/** 바이트(Node·테스트용) */
export async function htmlToDocxBytes(html: string, title: string): Promise<Uint8Array> {
  const { Packer } = await import('docx')
  return new Uint8Array(await Packer.toArrayBuffer(await buildDocument(html, title)))
}
