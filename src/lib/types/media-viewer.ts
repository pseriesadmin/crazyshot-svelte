/** 공통 이미지·문서 뷰어(MediaViewer)에 넘기는 항목 */
export interface MediaViewerItem {
  /** 원본(큰 이미지 또는 PDF) 주소 */
  url: string
  /** 썸네일 정렬 화면에 쓸 작은 이미지 주소(없으면 url) */
  thumbUrl?: string
  /** 제목·내려받기 파일명으로 쓸 이름(없으면 주소의 마지막 조각) */
  name?: string
  /** 종류(없으면 주소 확장자로 판별 — .pdf면 문서, 그 외는 이미지). 'youtube'는 videoId로 유튜브 영상을 재생한다 */
  type?: 'image' | 'pdf' | 'youtube'
  /** type이 'youtube'일 때 영상 ID(11자) */
  videoId?: string
  /** false면 이 항목은 이미지 편집 버튼을 숨긴다(기본 true — 뷰어에 onSave가 있을 때) */
  editable?: boolean
  /** 이 항목에서 허용할 편집 메뉴(기본 전부). 예: 계약서 배경 페이지는 크기·방향이 바뀌면 필드 위치가 어긋나므로 ['light','tone']만 */
  editTools?: Array<'crop' | 'light' | 'tone' | 'bg' | 'rotate'>
}
