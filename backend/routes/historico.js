'use strict';

/**
 * Trilha de auditoria (somente Atendimento/admin).
 *
 * Tudo que aparece aqui foi gravado pelo backend: acessos (login, senha
 * errada, bloqueio, logout) e o ciclo de vida de tarefas, clientes, setores
 * e usuarios, com autor, data, IP e navegador.
 */

const express = require('express');
const repo = require('../data');
const { exigirLogin, exigirAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { filtroHistoricoSchema } = require('../schemas/historico.schema');

const router = express.Router();
router.use(exigirLogin, exigirAdmin);

// GET /api/historico?entidade=&tipo=&usuario_id=&setor=&de=&ate=&q=&limit=
router.get('/', validate(filtroHistoricoSchema, 'query'), async (req, res, next) => {
  try {
    const f = req.query;
    const limite = f.limit || 60;
    // pede um a mais so para saber se existe proxima pagina
    const pagina = await repo.listarHistorico({
      limit: limite + 1,
      setorId: f.setor,
      entidade: f.entidade,
      tipo: f.tipo,
      usuarioId: f.usuario_id,
      de: f.de,
      ate: f.ate,
      q: f.q,
      antesDe: f.antes_de,
    });
    const temMais = pagina.length > limite;
    const historico = temMais ? pagina.slice(0, limite) : pagina;
    res.json({
      historico,
      tem_mais: temMais,
      // cursor para o "carregar mais"
      proximo: historico.length ? historico[historico.length - 1].id : null,
    });
  } catch (e) { next(e); }
});

// GET /api/historico/opcoes -> valores distintos para os seletores da tela
router.get('/opcoes', async (req, res, next) => {
  try { res.json(await repo.opcoesHistorico()); }
  catch (e) { next(e); }
});

module.exports = router;
