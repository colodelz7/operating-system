'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

// Historico curto que o front reenvia a cada mensagem. Nada aqui vira
// permissao: o modelo pode ler, mas quem decide o que pode ser feito e a
// sessao de quem esta conversando.
const MAX_HISTORICO = 12;

const mensagemSchema = z.object({
  mensagem: z.any().optional().transform((x) => v.texto(x, 2000))
    .refine((s) => s.length > 0, 'Escreva uma mensagem'),
  historico: z.any().optional().transform((x) => {
    if (!Array.isArray(x)) return [];
    return x.slice(-MAX_HISTORICO).map((m) => ({
      autor: (m && m.autor) === 'bot' ? 'bot' : 'usuario',
      texto: v.texto(m && m.texto, 4000),
    })).filter((m) => m.texto);
  }),
});

module.exports = { mensagemSchema, MAX_HISTORICO };
