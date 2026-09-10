'use strict';

/**
 * Criar notificacao passa por aqui, e nao direto pelo repositorio, para que
 * quem estiver com a tela aberta receba o aviso na hora (SSE) alem de o
 * registro ficar guardado.
 */

const repo = require('../data');
const { avisarNotificacao } = require('./eventos');

async function criarNotificacao(dados) {
  const n = await repo.criarNotificacao(dados);
  // o aviso e melhor-esforco: se ninguem estiver ouvindo, tudo bem
  try { avisarNotificacao(n || dados); } catch (_) { /* nao atrapalha a operacao */ }
  return n;
}

module.exports = { criarNotificacao };
