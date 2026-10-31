'use strict';

/**
 * Inscricao do aparelho nas notificacoes push. O navegador cria a inscricao
 * (com a chave publica VAPID daqui) e manda para ca; o envio acontece em
 * services/push.js.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../data');
const config = require('../config');
const { exigirLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { pushAtivo } = require('../services/push');

const router = express.Router();
router.use(exigirLogin);

// O servidor faz POST no endpoint informado. Se aceitasse qualquer URL, um
// usuario logado faria o servidor chamar enderecos internos (SSRF). Entao so
// https dos servicos de push dos navegadores.
const HOSTS_PUSH = [
  'fcm.googleapis.com', 'android.googleapis.com',     // Chrome, Edge (Android), Opera
  'push.services.mozilla.com',                        // Firefox
  'notify.windows.com',                               // Edge no Windows
  'push.apple.com',                                   // Safari (macOS e iOS)
];
function hostDePush(host) {
  const h = String(host || '').toLowerCase();
  return HOSTS_PUSH.some((d) => h === d || h.endsWith('.' + d));
}
const zEndpoint = z.any().optional().transform((x) => String(x ?? '').trim().slice(0, 1000))
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' && hostDePush(u.hostname);
    } catch (_) { return false; }
  }, 'Inscrição inválida');
const zChave = z.any().optional().transform((x) => String(x ?? '').trim().slice(0, 200))
  .refine((s) => /^[A-Za-z0-9_=-]+$/.test(s), 'Inscrição inválida');

const inscreverSchema = z.object({
  subscription: z.object({
    endpoint: zEndpoint,
    keys: z.object({ p256dh: zChave, auth: zChave }),
  }),
});
const desinscreverSchema = z.object({ endpoint: zEndpoint });

// GET /api/push/vapid  -> chave publica (null = push desligado no servidor)
router.get('/vapid', (req, res) => {
  res.json({ chave: pushAtivo() ? config.vapidPublica : null });
});

router.post('/inscrever', validate(inscreverSchema), async (req, res, next) => {
  try {
    if (!pushAtivo()) return res.status(503).json({ erro: 'Notificações push não configuradas no servidor' });
    const s = req.body.subscription;
    await repo.salvarInscricaoPush({
      usuario_id: req.usuario.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/desinscrever', validate(desinscreverSchema), async (req, res, next) => {
  try {
    await repo.removerInscricaoPush(req.body.endpoint, req.usuario.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
