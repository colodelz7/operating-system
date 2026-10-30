import { API } from './api';

/* Web Push no navegador e no celular. No iPhone o push so existe com o
   sistema instalado na tela de inicio (iOS 16.4 ou mais novo). */

export function suportaPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function ehIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad com iPadOS
}
export function estaInstalado() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function chaveParaBytes(base64) {
  const preenchimento = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + preenchimento).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(b64);
  return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
}

export async function registrarSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch (_) { return null; }
}

export async function pushLigadoNoServidor() {
  try { return !!(await API.get('/api/push/vapid')).chave; } catch (_) { return false; }
}

export async function estaAtivo() {
  if (!suportaPush() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch (_) { return false; }
}

export async function ativarPush() {
  if (!suportaPush()) throw new Error('Este navegador não recebe notificações push.');
  const { chave } = await API.get('/api/push/vapid');
  if (!chave) throw new Error('Notificações push não estão configuradas no servidor.');
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') throw new Error('As notificações foram bloqueadas neste aparelho.');
  const reg = await navigator.serviceWorker.ready;
  let inscricao = await reg.pushManager.getSubscription();
  if (!inscricao) {
    inscricao = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chave) });
  }
  await API.post('/api/push/inscrever', { subscription: inscricao.toJSON() });
  return true;
}

export async function desativarPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const inscricao = await reg.pushManager.getSubscription();
    if (inscricao) {
      await API.post('/api/push/desinscrever', { endpoint: inscricao.endpoint }).catch(() => {});
      await inscricao.unsubscribe();
    }
  } catch (_) { /* ja estava desligado */ }
  return true;
}
