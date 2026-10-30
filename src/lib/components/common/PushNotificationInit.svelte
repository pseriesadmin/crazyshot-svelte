<script lang="ts">
  // FCM 웹 푸시 등록 컴포넌트 — 로그인된 사용자(고객/관리자 공통) 레이아웃에 마운트.
  // SW 등록 → 알림 권한 요청 → 토큰 발급 → register_push_token RPC → 포그라운드 수신 시 csToast.
  import {
    PUBLIC_FIREBASE_API_KEY,
    PUBLIC_FIREBASE_APP_ID,
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    PUBLIC_FIREBASE_PROJECT_ID,
    PUBLIC_FIREBASE_VAPID_KEY,
  } from '$env/static/public'
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { authState } from '$lib/stores/auth'
  import { supabase } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'
  import { PUSH_TOKEN_STORAGE_KEY } from '$lib/utils/push'
  import { callTypedRpc } from '$lib/utils/rpc'
  import { buildUnifiedPushToastMessage } from '$lib/utils/pushToastMessage'

  // 인앱 브라우저(네이버·카카오톡·인스타그램·페이스북·라인·다음 앱, 안드로이드 웹뷰)는 알림 권한 선택을 저장하지 못하거나 권한 요청 때문에 화면을 다시 불러와,
  // 로그인 직후 새로고침이 반복되는 CS가 있었다(2026-10-30, 갤럭시·네이버 인앱). 이런 환경에서는 서비스워커 등록·알림 권한 요청을 건너뛴다.
  const IN_APP_BROWSER_UA = /NAVER\(inapp|KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|\bLine\/|DaumApps|; wv\)/i

  let initialized = false

  $effect(() => {
    const userId = $authState.user?.id
    if (!browser || !userId || initialized) return
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return
    if (IN_APP_BROWSER_UA.test(navigator.userAgent)) return
    initialized = true

    let disposeOnMessage: (() => void) | undefined

    ;(async () => {
      try {
        const [{ initializeApp }, { getMessaging, getToken, onMessage, isSupported }] = await Promise.all([
          import('firebase/app'),
          import('firebase/messaging'),
        ])

        if (!(await isSupported())) return

        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')

        if (Notification.permission === 'default') {
          const permission = await Notification.requestPermission()
          if (permission !== 'granted') return
        }
        if (Notification.permission !== 'granted') return

        const app = initializeApp({
          apiKey: PUBLIC_FIREBASE_API_KEY,
          projectId: PUBLIC_FIREBASE_PROJECT_ID,
          messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
          appId: PUBLIC_FIREBASE_APP_ID,
        })
        const messaging = getMessaging(app)

        const token = await getToken(messaging, {
          vapidKey: PUBLIC_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: registration,
        })

        if (token) {
          const lastRegistered = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY)
          if (lastRegistered !== token) {
            const { error } = await callTypedRpc(supabase, 'register_push_token', { p_token: token, p_platform: 'web' })
            if (!error) window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token)
          }
        }

        disposeOnMessage = onMessage(messaging, (payload) => {
          // 개별 push 문구(title/body)를 그대로 노출하지 않고 3종 표준 안내 문구로 단일화
          // (신규대화/답변/중요알림 — pushToastMessage.ts 참고, Stephen 확정)
          const notifyType = payload.data?.notifyType
          const message = buildUnifiedPushToastMessage(notifyType)

          const link = payload.data?.link
          csToast.info(message, link ? { onClick: () => goto(link) } : undefined)
        })
      } catch {
        // 권한 거부·미지원 브라우저·네트워크 오류 등 — 핵심 기능이 아니므로 조용히 무시
      }
    })()

    return () => {
      disposeOnMessage?.()
    }
  })
</script>
