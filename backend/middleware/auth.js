'use strict';

/**
 * Camada de seguranca do servidor.
 * TODA decisao de "quem e voce" e "o que voce pode ver/fazer"
 * acontece aqui, no backend. O front nunca decide permissao.
 */

const repo = require('../data');

// Exige usuario logado. Recarrega os dados do usuario do repo a cada
// request (nao confia em nada que o front mande sobre papel/setor).
async function exigirLogin(req, res, next) {
  const uid = req.session && req.session.usuarioId;
  if (!uid) return res.status(401).json({ erro: 'Não autenticado' });
  try {
    const usuario = await repo.buscarUsuarioPorId(uid);
    if (!usuario) {
      req.session.destroy(() => {});
      return res.status(401).json({ erro: 'Sessão inválida' });
    }
    req.usuario = usuario; // fonte da verdade vinda do banco
    next();
  } catch (e) { next(e); }
}

// Exige papel admin (Atendimento)
function exigirAdmin(req, res, next) {
  if (!req.usuario || req.usuario.papel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito ao Atendimento' });
  }
  next();
}

// Admin acessa qualquer setor; membro so o proprio.
function podeAcessarSetor(usuario, setorId) {
  if (usuario.papel === 'admin') return true;
  return usuario.setor_id === Number(setorId);
}

module.exports = { exigirLogin, exigirAdmin, podeAcessarSetor };
