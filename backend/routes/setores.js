'use strict';

const express = require('express');
const repo = require('../data');
const { exigirLogin, podeAcessarSetor } = require('../middleware/auth');

const router = express.Router();

// GET /api/setores
// Admin -> todos os setores. Membro -> apenas o seu.
router.get('/', exigirLogin, async (req, res, next) => {
  try {
    const todos = await repo.listarSetores();
    if (req.usuario.papel === 'admin') return res.json({ setores: todos });
    res.json({ setores: todos.filter((s) => s.id === req.usuario.setor_id) });
  } catch (e) { next(e); }
});

// GET /api/setores/:id/colunas
router.get('/:id/colunas', exigirLogin, async (req, res, next) => {
  try {
    const setorId = Number(req.params.id);
    if (!podeAcessarSetor(req.usuario, setorId)) {
      return res.status(403).json({ erro: 'Sem acesso a este setor' });
    }
    const colunas = await repo.listarColunas(setorId, req.usuario);
    res.json({ colunas });
  } catch (e) { next(e); }
});

// GET /api/setores/:id/usuarios  (para o seletor de responsaveis)
router.get('/:id/usuarios', exigirLogin, async (req, res, next) => {
  try {
    const setorId = Number(req.params.id);
    if (!podeAcessarSetor(req.usuario, setorId)) {
      return res.status(403).json({ erro: 'Sem acesso a este setor' });
    }
    const usuarios = await repo.listarUsuariosDoSetor(setorId);
    res.json({ usuarios });
  } catch (e) { next(e); }
});

module.exports = router;
