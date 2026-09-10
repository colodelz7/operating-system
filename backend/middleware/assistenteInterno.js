'use strict';

/**
 * Reconhece as chamadas que o proprio servidor faz a si mesmo quando o
 * assistente executa uma acao.
 *
 * O token vem de config.tokenInterno: aleatorio, gerado no boot, guardado so
 * na memoria deste processo. Um cliente de fora nao tem como adivinhar, e
 * mesmo que tivesse, a unica coisa que muda e o texto do registro na
 * auditoria. Permissao continua vindo da sessao.
 */

const config = require('../config');

function marcarChamadaDoAssistente(req, res, next) {
  const token = req.headers['x-assistente-interno'];
  if (token && token === config.tokenInterno) req.viaAssistente = true;
  next();
}

module.exports = { marcarChamadaDoAssistente };
