'use strict';

/**
 * Barramento de eventos do processo.
 *
 * Serve para avisar as telas abertas na hora em que algo acontece, em vez de
 * cada navegador ficar perguntando "tem novidade?" a cada 20 segundos. Quem
 * escuta e o endpoint SSE de notificacoes.
 *
 * E de proposito simples e local: com mais de uma instancia da API, cada uma
 * avisa os navegadores conectados nela, e o "ping" periodico do SSE garante
 * que ninguem fique com a tela velha por muito tempo.
 */

const { EventEmitter } = require('events');

const barramento = new EventEmitter();
// varias abas abertas somam ouvintes rapido; o padrao (10) e baixo demais
barramento.setMaxListeners(200);

/**
 * Avisa que houve notificacao nova.
 * setorId null = interessa a todo mundo (ex.: tarefa concluida).
 */
function avisarNotificacao(notificacao) {
  barramento.emit('notificacao', {
    setor_id: notificacao && notificacao.setor_id ? notificacao.setor_id : null,
    tipo: notificacao && notificacao.tipo ? notificacao.tipo : 'nova',
  });
}

module.exports = { barramento, avisarNotificacao };
