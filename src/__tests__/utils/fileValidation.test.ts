import { describe, it, expect } from 'vitest'
import {
  validateUploadFile,
  validateUploadFileSize,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from '../../lib/utils/fileValidation'

/**
 * fileValidation.ts — 채팅 첨부파일 PDF 누락 + 용량 상한 부재 결함 수정 회귀 테스트
 * (2026-09-08, Stephen 리포트: "채팅 세션 내 파일 공유 시 pdf가 제외되어 있는지 확인")
 *
 * 조사 결과 PDF 자체는 MIME 허용목록에 이미 있었으나(§15-1), 채팅 첨부 경로
 * (ChatWindow.svelte handleAttach / AdminChatPanel.svelte handleAdminAttach) 어디에도
 * validateUploadFile()이 호출되지 않아 검증 자체가 완전히 빠져 있었고, 용량 상한도
 * fileValidation.ts에 전혀 없었다(front-uiux.md §15-1a로 10MB 신규 명문화). 이 테스트는
 * validateUploadFile()이 PDF를 정상 허용함과, 새로 추가된 validateUploadFileSize()의
 * 경계값 동작을 고정한다.
 */

function makeFile(type: string, sizeBytes: number): File {
  return { type, size: sizeBytes } as File
}

describe('validateUploadFile — PDF 허용 확인', () => {
  it('application/pdf → 허용(ok: true)', () => {
    const result = validateUploadFile(makeFile('application/pdf', 1024))
    expect(result.ok).toBe(true)
  })

  it('허용되지 않는 MIME(예: image/gif) → 차단', () => {
    const result = validateUploadFile(makeFile('image/gif', 1024))
    expect(result.ok).toBe(false)
  })
})

describe('validateUploadFileSize — 10MB 상한(front-uiux.md §15-1a)', () => {
  it('상한 이하 → 허용', () => {
    const result = validateUploadFileSize(makeFile('application/pdf', MAX_UPLOAD_FILE_SIZE_BYTES - 1))
    expect(result.ok).toBe(true)
  })

  it('정확히 상한값 → 허용(경계값 포함)', () => {
    const result = validateUploadFileSize(makeFile('application/pdf', MAX_UPLOAD_FILE_SIZE_BYTES))
    expect(result.ok).toBe(true)
  })

  it('상한 초과 → 차단 + 안내 문구', () => {
    const result = validateUploadFileSize(makeFile('application/pdf', MAX_UPLOAD_FILE_SIZE_BYTES + 1))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('10MB')
  })

  it('커스텀 maxBytes 인자를 전달하면 그 값을 기준으로 판정(기존 5MB류 호출부 재사용 대비)', () => {
    const fiveMb = 5 * 1024 * 1024
    const result = validateUploadFileSize(makeFile('image/png', fiveMb + 1), fiveMb)
    expect(result.ok).toBe(false)
  })
})
