'use strict';

/**
 * Validacao do :id da URL.
 *
 * Sem isto, um id nao numerico (ou ausente) virava NaN e descia ate o banco:
 * no Postgres estourava 500 ("invalid input syntax for type integer: NaN") e
 * na memoria passava batido como "nao encontrado". Agora os dois respondem a
 * mesma coisa: 400, antes de qualquer consulta.
 */

function validarIdParam(req, res, next, valor) {
  if (!/^\d{1,12}$/.test(String(valor))) {
    return res.status(400).json({ erro: 'Identificador inválido' });
  }
  next();
}

// Aplica em todos os :id de um router.
function comIdValidado(router) {
  router.param('id', validarIdParam);
  return router;
}

module.exports = { validarIdParam, comIdValidado };
