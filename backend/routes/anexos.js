'use strict';

const path = require('path');
const express = require('express');
const repo = require('../data');
const { exigirLogin, podeAcessarSetor } = require('../middleware/auth');
const { PASTA_UPLOADS } = require('../middleware/upload');

const router = express.Router();

// GET /api/anexos/:id  -> baixa o arquivo (se o usuario tiver acesso a tarefa)
router.get('/:id', exigirLogin, async (req, res, next) => {
  try {
    const anexo = await repo.buscarAnexo(Number(req.params.id));
    if (!anexo) return res.status(404).json({ erro: 'Anexo não encontrado' });

    const tarefa = await repo.buscarTarefa(anexo.tarefa_id);
    if (!tarefa || !podeAcessarSetor(req.usuario, tarefa.setor_id)) {
      return res.status(403).json({ erro: 'Sem acesso' });
    }
    // envia o arquivo do disco com o nome original
    res.download(path.join(PASTA_UPLOADS, anexo.nome_arquivo), anexo.nome_original);
  } catch (e) { next(e); }
});

module.exports = router;
