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
    // Conta desativada perde o acesso na hora, mesmo com a sessao ja aberta.
    if (usuario.ativo === false) {
      req.session.destroy(() => {});
      return res.status(401).json({ erro: 'Conta desativada. Fale com o Atendimento.' });
    }
    // Senha trocada depois deste login: a sessao antiga morre aqui. E o que
    // faz trocar a senha realmente expulsar quem estava com ela.
    if ((usuario.senha_versao || 0) !== (req.session.senhaVersao || 0)) {
      req.session.destroy(() => {});
      return res.status(401).json({ erro: 'Sua senha mudou. Entre novamente.' });
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

/**
 * Quem pode cadastrar/editar cliente: admin, o setor Comercial e quem tiver a
 * permissao marcada na tela de Usuarios. Antes disso a regra existia so no
 * front, entao qualquer pessoa logada conseguia criar e editar cliente
 * chamando a API direto.
 */
function podeGerirClientes(usuario) {
  if (!usuario) return false;
  if (usuario.papel === 'admin') return true;
  if (usuario.setor_slug === 'comercial') return true;
  return usuario.pode_clientes === true;
}

function exigirGestaoDeClientes(req, res, next) {
  if (!podeGerirClientes(req.usuario)) {
    return res.status(403).json({ erro: 'Sem permissão para cadastrar ou editar clientes' });
  }
  next();
}

// Admin acessa qualquer setor; membro so o proprio.
function podeAcessarSetor(usuario, setorId) {
  if (usuario.papel === 'admin') return true;
  return usuario.setor_id === Number(setorId);
}

module.exports = { exigirLogin, exigirAdmin, podeAcessarSetor, podeGerirClientes, exigirGestaoDeClientes };
