import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** 배지타입 패널 — 형태 선택 버튼 이름(2026-11-16, Stephen 지시): '원형 이미지 타입' / '텍스트바 타입' */
const panel = readFileSync(path.resolve(process.cwd(), 'src/lib/components/cms/badge/BadgeTemplatePanel.svelte'), 'utf8')

describe('배지타입 패널 — 형태 버튼 이름', () => {
  it("'원형 이미지 타입' · '텍스트바 타입' 으로 표시한다", () => {
    expect(panel).toContain("onclick={() => (kind = 'image')}>원형 이미지 타입</button>")
    expect(panel).toContain("onclick={() => (kind = 'textbar')}>텍스트바 타입</button>")
    expect(panel).not.toContain('>이미지형</button>')
    expect(panel).not.toContain('>텍스트바형</button>')
  })
})

describe('배지타입 패널 — 저장 버튼 이름', () => {
  it("기존 배지타입을 열면 '수정', 새 배지타입이면 '저장'으로 표시한다", () => {
    expect(panel).toContain("onclick={save}>{template ? (saving ? '수정 중...' : '수정') : (saving ? '저장 중...' : '저장')}</button>")
  })
})
