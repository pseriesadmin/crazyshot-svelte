// src/routes/firebase-messaging-sw.js/+server.ts
// FCM 서비스워커를 /firebase-messaging-sw.js 경로로 서빙 — static/ 파일 대신 서버 라우트로
// 구현한 이유: static 자산은 빌드 시점에 $env 값을 주입할 수 없어 Firebase config를 소스에
// 하드코딩해야 하는데, core-rules.md 하드코딩 금지 원칙에 따라 $env/static/public을 그대로
// 사용하기 위함(SvelteKit + FCM 조합에서 널리 쓰이는 표준 우회 패턴).
import {
  PUBLIC_FIREBASE_API_KEY,
  PUBLIC_FIREBASE_APP_ID,
  PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  PUBLIC_FIREBASE_PROJECT_ID,
} from '$env/static/public'

const FIREBASE_JS_SDK_VERSION = '10.13.2'

export const GET = () => {
  const body = `
importScripts('https://www.gstatic.com/firebasejs/${FIREBASE_JS_SDK_VERSION}/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/${FIREBASE_JS_SDK_VERSION}/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '${PUBLIC_FIREBASE_API_KEY}',
  projectId: '${PUBLIC_FIREBASE_PROJECT_ID}',
  messagingSenderId: '${PUBLIC_FIREBASE_MESSAGING_SENDER_ID}',
  appId: '${PUBLIC_FIREBASE_APP_ID}'
});

// 백그라운드 수신 시 표시는 FCM webpush.notification 기본 동작에 위임 — 별도 핸들러 불필요
firebase.messaging();

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url === link && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache',
    },
  })
}
