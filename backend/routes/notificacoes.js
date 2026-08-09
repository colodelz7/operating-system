'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();

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

// PATCH /api/notificacoes/:id/lida
router.patch('/:id/lida', async (req, res, next) => {
  try {
    const ok = await repo.marcarNotificacaoLida(Number(req.params.id));
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