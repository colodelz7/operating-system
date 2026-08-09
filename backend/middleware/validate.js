'use strict';

/**
 * Middleware de validacao com zod. Substitui a validacao manual das rotas.
 *
 *   validate(schema)          -> valida/normaliza req.body
 *   validate(schema, 'query') -> valida/normaliza req.query
 *
 * Em caso de erro, responde 400 { erro: <primeira mensagem> } — mantendo
 * o mesmo formato de erro que o front ja consome (err.message = dados.erro).
 * Em caso de sucesso, substitui req[origem] pelos dados ja normalizados,
 * de modo que a rota trabalha com valores limpos (texto aparado, datas
 * validadas, inteiros convertidos, etc.).
 */

function validate(schema, origem = 'body') {
  return (req, res, next) => {
    const resultado = schema.safeParse(req[origem] || {});
    if (!resultado.success) {
      const primeiro = resultado.error.issues[0];
      const msg = (primeiro && primeiro.message) || 'Dados inválidos';
      return res.status(400).json({ erro: msg });
    }
    req[origem] = resultado.data;
    next();
  };
}

module.exports = { validate };
