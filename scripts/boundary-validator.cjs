#!/usr/bin/env node
// boundary-validator.js — Harness Flow v3.2
// Pre-commit에서 자동 실행: boundary-rules.yaml 기반 경계 위반 검사
// 실패 시 .claude/harness/learnings/boundary_violations.md 자동 저장

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─────────────────────────────────────────────────
// 설정 로드
// ─────────────────────────────────────────────────
const RULES_FILE = '.claude/harness/boundary-rules.yaml'
const REPORT_FILE = '.claude/harness/learnings/boundary_violations.md'
const SRC_DIR = 'src'
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function c(color, text) {
  return `${COLORS[color]}${text}${COLORS.reset}`
}

// ─────────────────────────────────────────────────
// 간단한 YAML 파서 (의존성 없음)
// ─────────────────────────────────────────────────
function parseSimpleYaml(content) {
  const rules = {}
  let currentRule = null
  const lines = content.split('\n')
  let inRules = false
  let inAutoCheck = false

  for (const rawLine of lines) {
    const line = rawLine
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // rules: 블록 시작
    if (trimmed === 'rules:') { inRules = true; inAutoCheck = false; continue }
    if (trimmed === 'auto_check:') { inRules = false; inAutoCheck = true; continue }
    if (trimmed === 'metadata:' || trimmed === 'exemptions:' || trimmed === 'changelog:') {
      inRules = false; inAutoCheck = false; continue
    }

    if (inRules) {
      // 규칙 이름 (들여쓰기 2칸)
      const ruleMatch = line.match(/^  ([a-zA-Z0-9_]+):$/)
      if (ruleMatch) {
        currentRule = ruleMatch[1]
        rules[currentRule] = {}
        continue
      }
      // 속성 (들여쓰기 4칸)
      if (currentRule) {
        const propMatch = line.match(/^    ([a-zA-Z_]+):\s*(.+)$/)
        if (propMatch) {
          const [, key, rawVal] = propMatch
          let val = rawVal.trim().replace(/^["']|["']$/g, '')
          if (val === 'true') val = true
          else if (val === 'false') val = false
          rules[currentRule][key] = val
        }
        // 배열 항목
        const arrMatch = line.match(/^    - (.+)$/)
        if (arrMatch) {
          const lastKey = Object.keys(rules[currentRule]).at(-1)
          if (lastKey && !Array.isArray(rules[currentRule][lastKey])) {
            rules[currentRule][lastKey] = []
          }
        }
      }
    }
  }
  return rules
}

// ─────────────────────────────────────────────────
// 파일 수집
// ─────────────────────────────────────────────────
function getAllFiles(dir, exts = ['ts', 'svelte', 'js', 'sql']) {
  const files = []
  if (!fs.existsSync(dir)) return files

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules', '.svelte-kit', 'dist', 'build', '.git'].includes(entry.name)) {
          walk(full)
        }
      } else {
        const ext = entry.name.split('.').at(-1)
        if (exts.includes(ext)) files.push(full)
      }
    }
  }
  walk(dir)
  return files
}

// staged 파일만 가져오기 (git diff --cached)
function getStagedFiles() {
  try {
    const result = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
    return result.trim().split('\n').filter(Boolean)
  } catch {
    return getAllFiles(SRC_DIR)
  }
}

// ─────────────────────────────────────────────────
// 마이그레이션 파일 수정 감지 (git-based)
// ─────────────────────────────────────────────────
function checkMigrationModified() {
  try {
    const modified = execSync('git diff --cached --name-only --diff-filter=M', {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
    return modified.trim().split('\n').filter(f => f.includes('supabase/migrations') && f.endsWith('.sql'))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────
// 경계 위반 검사
// ─────────────────────────────────────────────────
function checkFile(filePath, rules) {
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf8')
  const ext = filePath.split('.').at(-1)
  const violations = []

  for (const [ruleId, rule] of Object.entries(rules)) {
    if (!rule.pattern || !rule.severity) continue

    // 파일 타입 필터
    const allowedTypes = rule.file_types
      ? rule.file_types.replace(/[\[\]"']/g, '').split(',').map(s => s.trim())
      : ['ts', 'svelte', 'js']
    if (!allowedTypes.includes(ext)) continue

    // 예외 경로 필터
    if (rule.exceptions) {
      const exceptions = rule.exceptions.replace(/[\[\]"']/g, '').split(',').map(s => s.trim())
      if (exceptions.some(ex => filePath.includes(ex))) continue
    }

    // location 필터 (파일 경로 포함 여부)
    if (rule.location) {
      const locations = rule.location.replace(/[\[\]"']/g, '').split(',').map(s => s.trim())
      if (!locations.some(loc => filePath.includes(loc.replace(/\\/g, '/')))) continue
    }

    let regex
    try {
      regex = new RegExp(rule.pattern, rule.case_insensitive ? 'gi' : 'g')
    } catch {
      continue
    }

    const lines = content.split('\n')
    lines.forEach((line, idx) => {
      // harness-allow 제외
      if (line.includes('harness-allow')) return

      if (regex.test(line)) {
        regex.lastIndex = 0 // reset for 'g' flag
        violations.push({
          ruleId,
          severity: rule.severity || 'WARNING',
          message: rule.message || `Rule ${ruleId} violated`,
          file: filePath,
          line: idx + 1,
          content: line.trim().slice(0, 80),
          documentation: rule.documentation || '',
        })
      }
      regex.lastIndex = 0
    })
  }
  return violations
}

// ─────────────────────────────────────────────────
// 리포트 저장
// ─────────────────────────────────────────────────
function saveReport(violations, timestamp) {
  const dir = path.dirname(REPORT_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const errors = violations.filter(v => v.severity === 'ERROR')
  const warnings = violations.filter(v => v.severity === 'WARNING')

  const lines = [
    `# 🚧 Boundary Violations Report`,
    ``,
    `**시각**: ${timestamp}`,
    `**총 위반**: ${violations.length}건 (ERROR: ${errors.length}, WARNING: ${warnings.length})`,
    ``,
    `---`,
    ``,
    `## ❌ ERROR (커밋 차단)`,
    ``,
  ]

  if (errors.length === 0) {
    lines.push('없음')
  } else {
    errors.forEach(v => {
      lines.push(`### \`${v.ruleId}\``)
      lines.push(`- **파일**: \`${v.file}:${v.line}\``)
      lines.push(`- **내용**: \`${v.content}\``)
      lines.push(`- **메시지**: ${v.message}`)
      if (v.documentation) lines.push(`- **참고**: \`.claude/rules/${v.documentation}\``)
      lines.push(``)
    })
  }

  lines.push(`## ⚠️ WARNING (진행 허용)`, ``)
  if (warnings.length === 0) {
    lines.push('없음')
  } else {
    warnings.forEach(v => {
      lines.push(`- \`${v.file}:${v.line}\` — ${v.message}`)
    })
  }

  lines.push(``, `---`, ``, `> 이 파일은 Harness Self-Correction Runner가 자동 생성합니다.`)
  lines.push(`> 에이전트가 다음 턴에 자동 로드하여 위반 사항을 수정합니다.`)

  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf8')
}

// ─────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────
function main() {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  console.log(c('cyan', `\n🚧 Boundary Validator v3.2 — ${timestamp}`))

  // 규칙 로드
  if (!fs.existsSync(RULES_FILE)) {
    console.log(c('yellow', `⚠️ boundary-rules.yaml not found. Skipping.`))
    process.exit(0)
  }
  const rulesContent = fs.readFileSync(RULES_FILE, 'utf8')
  const rules = parseSimpleYaml(rulesContent)

  // 마이그레이션 파일 수정 감지
  const modifiedMigrations = checkMigrationModified()
  const allViolations = []

  if (modifiedMigrations.length > 0) {
    modifiedMigrations.forEach(f => {
      allViolations.push({
        ruleId: 'db_01_no_migration_edit',
        severity: 'ERROR',
        message: '❌ DB-01: 기존 마이그레이션 파일 수정 금지 → 새 파일로 ALTER 처리',
        file: f,
        line: 0,
        content: '(migration file modified)',
        documentation: 'core-rules.md',
      })
    })
  }

  // staged 파일 검사
  const stagedFiles = getStagedFiles().filter(f => f.startsWith('src/'))
  const checkedFiles = new Set()

  for (const file of stagedFiles) {
    if (!fs.existsSync(file) || checkedFiles.has(file)) continue
    checkedFiles.add(file)
    const fileViolations = checkFile(file, rules)
    allViolations.push(...fileViolations)
  }

  // ── 결과 출력 ────────────────────────────────
  const errors = allViolations.filter(v => v.severity === 'ERROR')
  const warnings = allViolations.filter(v => v.severity === 'WARNING')

  if (errors.length > 0) {
    console.log(c('red', `\n❌ ERROR — ${errors.length}건 (커밋 차단)`))
    errors.forEach(v => {
      console.log(c('red', `  ${v.ruleId}`))
      console.log(c('gray', `  → ${v.file}:${v.line}`))
      console.log(`  ${v.message}`)
      if (v.documentation) console.log(c('gray', `  참고: .claude/rules/${v.documentation}`))
      console.log()
    })
  }

  if (warnings.length > 0) {
    console.log(c('yellow', `⚠️  WARNING — ${warnings.length}건`))
    warnings.forEach(v => {
      console.log(c('yellow', `  ${v.ruleId} | ${v.file}:${v.line}`))
      console.log(`  ${v.message}`)
    })
    console.log()
  }

  // ── 리포트 저장 (위반 있을 때만) ─────────────
  if (allViolations.length > 0) {
    saveReport(allViolations, timestamp)
    console.log(c('gray', `📄 리포트 저장: ${REPORT_FILE}`))
    console.log(c('gray', `   → 에이전트가 다음 턴에 자동 로드합니다`))
  }

  // ── 최종 판정 ─────────────────────────────────
  if (errors.length > 0) {
    console.log(c('red', `\n🚫 커밋 차단: ERROR ${errors.length}건 수정 필요`))
    process.exit(1)
  }

  if (warnings.length > 0) {
    console.log(c('yellow', `✓ 경계 검사 통과 (WARNING ${warnings.length}건 — GATE C에서 확인 권장)`))
  } else {
    console.log(c('green', `✓ 경계 검사 완전 통과`))
  }

  process.exit(0)
}

main()
