// オフライン動作用 Service Worker（cache-first）
// バージョンを上げると新しいキャッシュ名になり、古いキャッシュは activate 時に破棄される
const CACHE_VERSION = 'peds-arrhythmia-v6';
const CACHE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/drugData.js',
  './js/calculator.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/flowcharts/jcs2020_fig33_svt_stop.png',
  './assets/flowcharts/jcs2020_fig36_vt_stop.png',
  './assets/flowcharts/fig2_afib_rate_control.png',
  './assets/flowcharts/fig3_aflutter_treatment.png',
  './assets/flowcharts/fig10_vf_pulseless_vt_acute.png',
  './assets/flowcharts/fig11_vf_pulseless_vt_prevent.png',
  './assets/flowcharts/table13_14_bradycardia.png',
  './assets/flowcharts/table15_pacemaker.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CACHE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // ネットワークには一切データを送らない設計のため、常にキャッシュ優先で返す。
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
