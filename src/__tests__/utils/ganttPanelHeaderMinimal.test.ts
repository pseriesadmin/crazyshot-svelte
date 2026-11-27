import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 홈 간트 상세 카드 헤더 최소 구성(2026-11-27): '대여' 라벨·상태 배지는 이 카드 안에서만 숨기고, 공용 패널(다른 화면)은 그대로 둔다.
describe('홈 간트 상세 카드 헤더', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  const panel = readFileSync('src/lib/components/cms/RentalDetailPanel.svelte', 'utf8')
  it('간트 오버레이 안에서만 .panel-label·.panel-status 를 숨긴다', () => {
    expect(gantt).toMatch(/\.gantt-detail-overlay :global\(\.panel-label\),\s*\.gantt-detail-overlay :global\(\.panel-status\)\s*\{\s*display:\s*none;/)
  })
  it('공용 패널 자체는 라벨·배지를 계속 그린다(예약대여현황 등 다른 화면 무영향)', () => {
    expect(panel).toContain('<span class="panel-label">대여</span>')
    expect(panel).toContain('<span class="panel-status">{rowStatusLabel}</span>')
    expect(panel).not.toMatch(/\.panel-status\s*\{[^}]*display:\s*none/)
  })
})

describe('홈 간트 하단 채움', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  const tabs = readFileSync('src/lib/components/cms/dashboard/CmsDashboardTabs.svelte', 'utf8')
  it('하단 여백 0 + 부모 아래 패딩(32px)을 음수 margin 으로 상쇄해 창 맨 아래까지 채운다', () => {
    expect(gantt).toMatch(/const BOTTOM_GAP = 0\b/)
    expect(gantt).toMatch(/\.gantt-outer \{[^}]*margin-bottom:\s*-32px/)
    expect(tabs).toMatch(/\.dashboard-wrap \{[^}]*padding:\s*20px 24px 32px/) // 부모 패딩이 바뀌면 이 상쇄값도 함께 바꿀 것
  })
})

describe('홈 간트 월 헤더 높이', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('월 헤더는 52px(기존 26px 의 2배)이고, 높이 계산 상수(HEADER_H)와 CSS 가 같은 값이다', () => {
    expect(gantt).toMatch(/const MONTH_H\s*=\s*52\b/)
    expect(gantt).toMatch(/\.gantt-month-header \{[^}]*height:\s*52px/)
    expect(gantt).toMatch(/const HEADER_H\s*=\s*MONTH_H \+ 40\b/) // 월 52 + 일자 40 = 92
  })
})

describe('홈 간트 막대 안쪽 여백', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('막대 안쪽 여백은 위아래 4px·좌우 12px 이고 box-sizing 이 border-box 로 고정돼 폭·높이가 늘어나지 않는다', () => {
    const rule = /\.gantt-bar \{([^}]*)\}/.exec(gantt)?.[1] ?? ''
    expect(rule).toMatch(/padding:\s*4px 12px/)
    expect(rule).toMatch(/box-sizing:\s*border-box/)
  })
})

describe('홈 간트 헤더 고정(세로 스크롤 겹침 방지)', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('헤더 래퍼는 위에 고정되고(sticky top 0, z-index 3) 전체 격자 폭까지 흰 배경이 덮인다(width: max-content)', () => {
    const rule = /\.gantt-header-wrap \{([^}]*)\}/.exec(gantt)?.[1] ?? ''
    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/top:\s*0/)
    expect(rule).toMatch(/z-index:\s*3/)
    expect(rule).toMatch(/background:\s*var\(--cs-white\)/)
    expect(rule).toMatch(/width:\s*max-content/)
    expect(rule).toMatch(/min-width:\s*100%/)
  })
  it('막대는 헤더보다 낮은 층(z-index 3 미만 또는 없음)이다', () => {
    const bar = /\.gantt-bar \{([^}]*)\}/.exec(gantt)?.[1] ?? ''
    const z = /z-index:\s*(\d+)/.exec(bar)?.[1]
    expect(z === undefined || Number(z) < 3).toBe(true)
  })
})

describe('홈 간트 선택 막대 표시', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('선택 막대는 면 색을 바꾸지 않고 밝은 아웃라인(--cs-purple-light 2px)만 둔다', () => {
    const sel = /\.gantt-bar\.gantt-bar-selected \{([^}]*)\}/.exec(gantt)?.[1] ?? ''
    expect(sel).toMatch(/outline:\s*2px solid var\(--cs-purple-light\)/)
    expect(sel).toMatch(/outline-offset:\s*1px/)
    expect(sel).not.toMatch(/background/)
    expect(gantt).not.toContain('.gantt-bar-selected::after')
    expect(gantt).not.toContain('--bar-c')
  })
})

describe('홈 간트 월 라벨 고정', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('월 라벨은 각 월 칸 안에서 sticky left 로 고정되고(가로 스크롤을 따라 흐르지 않음), 월 칸은 왼쪽 정렬이다', () => {
    const label = /\.gantt-month-label \{([^}]*)\}/.exec(gantt)?.[1] ?? ''
    expect(label).toMatch(/position:\s*sticky/)
    expect(label).toMatch(/left:\s*0/)
    const month = /\.gantt-month-header \{([^}]*)\}/.exec(gantt)?.[1] ?? ''
    expect(month).toMatch(/justify-content:\s*flex-start/)
    expect(gantt).toContain('<span class="gantt-month-label">{group.label}</span>')
  })
})

describe('홈 간트 상태별 보기 드롭다운', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('cms-uiux §12 에 따라 <select> 가 아니라 SuggestPicker 공통 컴포넌트를 쓰고, 월 행 오른쪽에 폭 0 sticky 래퍼로 고정한다', () => {
    expect(gantt).toContain("import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'")
    expect(gantt).not.toMatch(/<select/)
    const wrap = /\.gantt-month-filter-wrap \{([^}]*)\}/.exec(gantt)?.[1] ?? ''
    expect(wrap).toMatch(/position:\s*sticky/)
    expect(wrap).toMatch(/right:\s*12px/)
    expect(wrap).toMatch(/width:\s*0/)
  })
  it('걸러낸 예약은 줄 배치 입력에서 빠진다(assignLanes 앞에서 filter)', () => {
    expect(gantt).toMatch(/assignLanes\(\[\.\.\.rowsMap\.values\(\)\]\.filter\(matchesStatusFilter\)/)
  })
})

describe('홈 간트 드롭다운 보강(낮은 창 잘림·가려진 예약 카드)', () => {
  const gantt = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('목록 레이어 최대 높이가 간트 스크롤 영역 높이에 연동된다(낮은 창에서 아래가 잘리지 않고, 극단적으로 낮아도 하한 120px)', () => {
    expect(gantt).toMatch(/style="--gantt-scroll-h:\{scrollAreaHeight\}px"/)
    expect(gantt).toMatch(/\.gantt-month-filter :global\(\.suggest-picker-layer\) \{[^}]*max-height:\s*min\(280px, max\(120px, calc\(var\(--gantt-scroll-h\) - 56px\)\)\)/)
  })
  it('보기 선택이 바뀔 때만(selectedRow 는 untrack) 가려진 예약의 상세 카드를 닫는다', () => {
    const eff = /\$effect\(\(\) => \{\s*void statusFilter([\s\S]*?)\n {2}\}\)/.exec(gantt)?.[1] ?? ''
    expect(eff).toMatch(/untrack\(\(\) => selectedRow\)/)
    expect(eff).toMatch(/!matchesStatusFilter\(open\)/)
    expect(eff).toMatch(/selectedRow = null/)
  })
})
