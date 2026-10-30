'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { comIdValidado } = require('../middleware/params');
const { barramento } = require('../services/eventos');

const router = express.Router();
// :id sempre numerico (nunca chega NaN no banco)
comIdValidado(router);

// Qualquer usuário logado acessa suas notificações.
// Admin (atendimento) vê todas; membro vê as do próprio setor (+ globais).
router.use(exigirLogin);

function escopoSetor(usuario) {
  return usuario.papel === 'admin' ? null : usuario.setor_id;
}

// GET /api/notificacoes?nao_lidas=1
router.get('/', async (req, res, next) => {
  try {
    const setorId = escopoSetor(req.usuario);
    const apenasNaoLidas = req.query.nao_lidas === '1';
    const notificacoes = await repo.listarNotificacoes({ apenasNaoLidas, setorId });
    const naoLidas = (await repo.listarNotificacoes({ apenasNaoLidas: true, setorId })).length;
    res.json({ notificacoes, nao_lidas: naoLidas });
  } catch (e) { next(e); }
});

/**
 * GET /api/notificacoes/stream  (Server-Sent Events)
 *
 * A tela abre esta conexão e fica ouvindo. Quando nasce uma notificação do
 * escopo da pessoa, mandamos um aviso e o front recarrega a lista. Isso
 * substitui a pergunta a cada 20 segundos que existia antes: menos requisição
 * e o aviso chega na hora.
 */
router.get('/stream', (req, res) => {
  const meuSetor = escopoSetor(req.usuario); // null = admin (vê tudo)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx não segura o fluxo
  });
  res.write('retry: 5000\n\n'); // se a conexão cair, o navegador volta em 5s

  const enviar = (evento, dados) => {
    res.write(`event: ${evento}\ndata: ${JSON.stringify(dados || {})}\n\n`);
  };

  enviar('pronto', { escopo: meuSetor === null ? 'todos' : meuSetor });

  const aoNotificar = (info) => {
    // membro só é avisado do próprio setor (ou de aviso geral)
    if (meuSetor !== null && info.setor_id != null && info.setor_id !== meuSetor) return;
    enviar('atualizar', info);
  };
  barramento.on('notificacao', aoNotificar);

  // chat: o mesmo canal leva o aviso de mensagem nova, só para quem é membro
  const meuId = req.usuario.id;
  const aoChat = (info) => {
    if (!info.membros.includes(meuId)) return;
    enviar('chat', { conversa_id: info.conversa_id, mensagem_id: info.mensagem_id });
  };
  barramento.on('chat', aoChat);

  // ping para o proxy não derrubar a conexão por ociosidade
  const ping = setInterval(() => enviar('ping', { t: Date.now() }), 25000);

  const encerrar = () => {
    clearInterval(ping);
    barramento.off('notificacao', aoNotificar);
    barramento.off('chat', aoChat);
    res.end();
  };
  req.on('close', encerrar);
  req.on('error', encerrar);
});

// PATCH /api/notificacoes/:id/lida
// So marca notificacao que o proprio usuario enxerga: membro nao mexe no
// sino de outro setor.
router.patch('/:id/lida', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const minhas = await repo.listarNotificacoes({ setorId: escopoSetor(req.usuario) });
    if (!minhas.some((n) => n.id === id)) {
      return res.status(404).json({ erro: 'Notificação não encontrada' });
    }
    const ok = await repo.marcarNotificacaoLida(id);
    if (!ok) return res.status(404).json({ erro: 'Notificação não encontrada' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PATCH /api/notificacoes/ler-todas
router.patch('/ler-todas', async (req, res, next) => {
  try { await repo.marcarTodasNotificacoesLidas(escopoSetor(req.usuario)); res.json({ ok: true }); }
  catch (e) { next(e); }
});

module.exports = router;
