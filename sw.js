/* สมุดยืมอุปกรณ์ — service worker: เก็บไฟล์แอปไว้ในเครื่องให้เปิดเร็วและเปิดได้แม้เน็ตหลุด
   (ข้อมูลยืม-คืนยังต้องใช้อินเทอร์เน็ตเสมอ) เปลี่ยนเลขเวอร์ชันเมื่ออัปเดตไฟล์แอป */
const CACHE = 'lend-app-v3.0.0';
const ASSETS = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './icon-maskable-512.png', './apple-touch-icon.png', './vendor/qrcode.js', './vendor/html5-qrcode.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // ไม่ยุ่งกับ Google Apps Script
  // ใช้ไฟล์ล่าสุดจากเน็ตก่อน ถ้าเน็ตหลุดค่อยใช้ไฟล์ที่เก็บไว้
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html')))
  );
});
