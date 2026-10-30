'use strict';

/**
 * Notificacoes push (Web Push): chegam no celular ou no computador mesmo com
 * a aba do sistema fechada.
 *
 * Tudo aqui e melhor-esforco: sem chaves VAPID o push fica desligado, e um
 * envio que falha nunca derruba a operacao que o disparou. Aparelho que o
 * servico de push diz que nao existe mais (404/410) sai da lista sozinho.
 */

const webpush = require('web-push');
const config = require('../config');
const repo = require('../data');

const ativo = !!(config.vapidPublica && config.vapidPrivada);
if (ativo) {
  try {
    webpush.setVapidDetails(config.vapidContato, config.vapidPublica, config.vapidPrivada);
  } catch (e) {
    console.error('[push] chaves VAPID invalidas, push desligado:', e.message);
  }
}

function pushAtivo() {
  return ativo;
}

/**
 * Envia para todos os aparelhos das pessoas indicadas.
 * conteudo: { titulo, corpo, url, tag }
 */
async function enviarPara(usuarioIds, conteudo) {
  if (!ativo) return 0;
  const ids = Array.from(new Set((usuarioIds || []).filter((x) => Number.isInteger(x))));
  if (!ids.length) return 0;

  let enviados = 0;
  try {
    const inscricoes = await repo.listarInscricoesPush(ids);
    const corpo = JSON.stringify({
      titulo: String(conteudo.titulo || 'Sistema Operacional').slice(0, 120),
      corpo: String(conteudo.corpo || '').slice(0, 300),
      url: String(conteudo.url || '/'),
      tag: conteudo.tag ? String(conteudo.tag).slice(0, 60) : undefined,
    });
    await Promise.all(inscricoes.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          corpo,
          { TTL: 60 * 60 * 12 },
        );
        enviados++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await repo.removerInscricaoPush(s.endpoint).catch(() => {});
        } else {
          console.error('[push] falha ao enviar:', e && (e.statusCode || e.message));
        }
      }
    }));
  } catch (e) {
    console.error('[push] erro ao preparar envio:', e.message);
  }
  return enviados;
}

// Quem recebe uma notificacao de setor: o setor (ou todos, se for geral) e os admins.
async function idsDoEscopo(setorId) {
  const usuarios = await repo.listarUsuarios();
  return usuarios
    .filter((u) => u.ativo !== false && (setorId == null || u.setor_id === setorId || u.papel === 'admin'))
    .map((u) => u.id);
}

module.exports = { pushAtivo, enviarPara, idsDoEscopo };
