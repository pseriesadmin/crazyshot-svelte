/**
 * features.ts — 통합 편집기 기능 on/off (호스트가 필요한 것만 켠다)
 */
export interface DocEditorFeatures {
  /** 글꼴·글자색 피커 */
  fontColor: boolean
  /** 링크 */
  link: boolean
  /** 표 편집(삽입·행/열·병합·헤더·삭제) */
  table: boolean
  /** 표 행의 '반복 영역' 지정/해제 (table이 켜져 있어야 의미 있음) */
  repeatRow: boolean
  /** 이미지 삽입(업로드) */
  image: boolean
  /** 서명/직인 삽입 (listSignatureAssets 필요) */
  signature: boolean
  /** HTML 소스 보기/적용 */
  source: boolean
  /** 확대/축소 */
  zoom: boolean
  /** 문단 유형(본문·제목·인용) 드롭다운 + 서식 지우기 */
  paragraph: boolean
  /** 구분선 삽입 */
  divider: boolean
  /** 이모지 삽입 */
  emoji: boolean
  /**
   * ⚠️ 아래 3개는 '렌더 쪽에도 같은 확장이 등록돼야' 문서가 그대로 그려진다(P6-b).
   * 호스트의 렌더 경로(예: 고객 서명 화면)가 해당 확장을 모르면 서식이 사라진다. DOC_EDITOR_EXTENSIONS 와 같은 집합으로 렌더하는 호스트는 기본 켜짐,
   * 별도 렌더 집합을 쓰는 호스트가 아직 확장을 등록하지 않았다면 features 로 끄고 사용한다.
   * 켜려면 core/extensions.ts 의 DOC_EDITOR_EXTENSIONS 에 FontSize·BackgroundColor·Indent 가 등록돼 있어야 한다.
   */
  /** 글자 크기(−/+/프리셋) */
  fontSize: boolean
  /** 글자 배경색 */
  bgColor: boolean
  /** 들여쓰기/내어쓰기 */
  indent: boolean
}

export const DEFAULT_FEATURES: DocEditorFeatures = {
  fontColor: true,
  link: true,
  table: true,
  repeatRow: true,
  image: true,
  signature: true,
  source: true,
  zoom: true,
  paragraph: true,
  divider: true,
  emoji: true,
  fontSize: true,
  bgColor: true,
  indent: true,
}
