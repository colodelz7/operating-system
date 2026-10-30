/* Service worker do Sistema Operacional: recebe o push e trata o clique.
   Simples de proposito, sem cache offline, para nunca servir versao velha
   da tela. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = {}; }
  event.waitUntil(self.registration.showNotification(d.titulo || 'Sistema Operacional', {
    body: d.corpo || '',
    icon: '/icone-192.png',
    badge: '/icone-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    lang: 'pt-BR',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // so caminho do proprio sistema: o push nunca abre outro site
  const bruto = (event.notification.data && event.notification.data.url) || '/';
  const alvo = new URL(bruto, self.location.origin);
  const url = alvo.origin === self.location.origin ? alvo.href : self.location.origin + '/';
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const j of janelas) {
      if ('focus' in j) {
        try { await j.navigate(url); } catch (_) { /* janela de outra origem */ }
        return j.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
  })());
});
