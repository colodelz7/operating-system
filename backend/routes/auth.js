'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { loginSchema } = require('../schemas/auth.schema');

const router = express.Router();

// POST /api/auth/login  { usuario, senha }
// rate-limit por IP + validacao de schema antes de tocar no banco.
router.post('/login', loginRateLimit, validate(loginSchema), async (req, res, next) => {
  try {
    const usuario = String(req.body.usuario || '').toLowerCase().trim();
    const senha = String(req.body.senha || '');

    const u = await repo.buscarUsuarioPorLogin(usuario);
    // mensagem generica de proposito (nao revela se o usuario existe)
    const generico = { erro: 'Usuário ou senha inválidos' };
    if (!u) { await bcrypt.compare(senha, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinva'); return res.status(401).json(generico); }

    const ok = await bcrypt.compare(senha, u.senha_hash);
    if (!ok) return res.status(401).json(generico);

    // regenera a sessao no login (evita fixation)
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.usuarioId = u.id;
      req.session.save((err2) => {
        if (err2) return next(err2);
        res.json({ ok: true });
      });
    });
  } catch (e) { next(e); }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('colodel.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me  -> dados do usuario logado (sem senha)
router.get('/me', exigirLogin, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
