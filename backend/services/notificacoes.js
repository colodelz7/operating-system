'use strict';

/**
 * Criar notificacao passa por aqui, e nao direto pelo repositorio, para que
 * quem estiver com a tela aberta receba o aviso na hora (SSE) alem de o
 * registro ficar guardado.
 */

const repo = require('../data');
const { avisarNotificacao } = require('./eventos');
const push = require('./push');

async function criarNotificacao(dados) {
  const n = await repo.criarNotificacao(dados);
  // o aviso e melhor-esforco: se ninguem estiver ouvindo, tudo bem
  try { avisarNotificacao(n || dados); } catch (_) { /* nao atrapalha a operacao */ }
  // push no aparelho: sem await, a resposta da API nao espera o envio
  if (push.pushAtivo()) {
    const alvo = n || dados;
    push.idsDoEscopo(alvo.setor_id || null)
      .then((ids) => push.enviarPara(ids, {
        titulo: alvo.titulo,
        corpo: alvo.mensagem,
        url: alvo.tarefa_id ? `/kanban?tarefa=${alvo.tarefa_id}` : '/',
        tag: alvo.tarefa_id ? `tarefa-${alvo.tarefa_id}` : undefined,
      }))
      .catch(() => { /* push nunca derruba a operacao */ });
  }
  return n;
}

module.exports = { criarNotificacao };
