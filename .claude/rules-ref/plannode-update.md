# plannode-update.md — plannode.tree JSON 업데이트 규칙
# Harness Flow v3.2 | crazyshot-re_vX.XX-plannode-tree.json 작업 시 필수 준수

---

## ⛔ 절대 금지 (v1.57 사고 재발 방지)

```
❌ 기존 노드의 parent_id 변경 금지
❌ 기존 노드의 num이 가리키는 내용을 다른 내용으로 덮어쓰기 금지
❌ 신규 노드에 비표준 키 사용 금지: children / status / tags / isTDD
❌ schema_notes 배열에 object(dict) 추가 금지 — string만 허용
❌ 기존 노드의 node_type / mx / my / badges / metadata 구조 변경 금지
```

---

## 업데이트 전 필수 확인 (30초 규칙)

```
1. 대상 노드의 num이 무엇을 가리키는지 description 앞부분 확인
2. 형제 노드의 키 구조 확인 (표준 포맷 기준)
3. 신규 노드 num 배정: 형제 노드 최대 num + 1
```

---

## 표준 노드 포맷 (신규 노드 추가 시 반드시 이 구조)

```json
{
  "id": "고유-kebab-id",
  "parent_id": "부모노드id",
  "name": "노드명",
  "description": "상세 내용",
  "num": "PRD.X.X.X",
  "badges": ["form", "auth"],
  "metadata": {
    "badges": {
      "dev": ["AUTH"],
      "ux": ["FORM"],
      "prj": []
    }
  },
  "node_type": "feature",
  "mx": null,
  "my": null
}
```

**허용 node_type**: `module` | `feature` | `screen` | `api`

---

## 기존 노드 업데이트 시 허용 필드

```
✅ 수정 가능: name, description
❌ 수정 금지: id, parent_id, num, node_type, mx, my, badges, metadata
```

---

## schema_notes 추가 형식

```python
# ✅ 올바른 형식 (string)
"v1.58 (2026-07-02): PRD.1.3 CMS 메뉴구조 업데이트 | PRD.1.3.4 계정관리 추가"

# ❌ 금지 (object)
{"version": "v1.58", "changes": [...]}
```

---

## 업데이트 후 필수 검증 3종 (Python)

```python
nodes = data['nodes']
schema_notes = data.get('schema_notes', [])

# 1. null parent 노드는 PRD 루트 1개만 허용
null_nodes = [n for n in nodes if n.get('parent_id') is None]
assert len(null_nodes) == 1, f"null parent 노드 {len(null_nodes)}개 — 파편화 오류"

# 2. schema_notes는 전부 string
note_types = set(type(n).__name__ for n in schema_notes)
assert note_types == {'str'}, f"schema_notes에 비문자열 포함: {note_types}"

# 3. 비표준 키 노드 없음
non_standard = [n.get('num') for n in nodes if 'children' in n or 'isTDD' in n]
assert not non_standard, f"비표준 키 노드: {non_standard}"

print("✅ 검증 통과")
```

---

## project 객체 허용 키 (추가 금지)

```
허용: author, created_at, description, end_date, id, name, owner_user_id, start_date, updated_at
❌ 금지: version, exportedAt, updatedAt — 툴이 로드 거부함
```

업데이트 시 변경 가능한 필드: `id`, `name`, `description`, `updated_at`만

---

## 버전 파일 명명 규칙

```
소스: crazyshot-re_vX.XX-plannode-tree.json
저장: crazyshot-re_vX.XX+1-plannode-tree.json  (별도 파일로 저장)
위치: /Users/stevenmac/Documents/PSERIES/CRAZYSHOT/Dev/
```

---

*plannode-update.md | Harness Flow v3.2 | 2026-07-02 신설*
