'use strict';

/**
 * Equipe: a lista de colegas que qualquer pessoa logada pode ver (para
 * escolher participante de evento, abrir conversa no chat, etc.) e a foto
 * de perfil.
 *
 * A gestao de usuarios (login, papel, senha) continua so em /api/usuarios,
 * restrita ao admin. Aqui sai apenas nome, setor e foto.
 */

const express = require('express');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { uploadImagem, apagarArquivo, caminhoSeguro } = require('../middleware/upload');
const { conferirAssinatura } = require('../middleware/assinaturaArquivo');
const { comIdValidado } = require('../middleware/params');

const router = express.Router();
comIdValidado(router);
router.use(exigirLogin);

// GET /api/equipe
router.get('/', async (req, res, next) => {
  try { res.json({ equipe: await repo.listarEquipe() }); }
  catch (e) { next(e); }
});

// POST /api/equipe/eu/avatar   (campo "foto"; troca a propria foto)
router.post('/eu/avatar', uploadImagem.single('foto'), conferirAssinatura, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Envie uma imagem PNG, JPG ou WEBP' });
    const r = await repo.definirAvatar(req.usuario.id, req.file.filename);
    if (r && r.anterior) apagarArquivo(r.anterior);
    res.json({ avatar_path: req.file.filename });
  } catch (e) { next(e); }
});

// DELETE /api/equipe/eu/avatar   (volta para as iniciais)
router.delete('/eu/avatar', async (req, res, next) => {
  try {
    const r = await repo.definirAvatar(req.usuario.id, null);
    if (r && r.anterior) apagarArquivo(r.anterior);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/equipe/:id/avatar   (a imagem; o ?v= do front so quebra o cache)
router.get('/:id/avatar', async (req, res, next) => {
  try {
    const u = await repo.buscarUsuarioPorId(Number(req.params.id));
    const destino = u && u.avatar_path ? caminhoSeguro(u.avatar_path) : null;
    if (!destino) return res.status(404).end();
    // a URL muda quando a foto muda (?v=arquivo), entao pode ficar em cache
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(destino, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (e) { next(e); }
});

module.exports = router;
