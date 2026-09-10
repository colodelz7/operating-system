'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

// O texto do comentario. Autor e tarefa vem da sessao e da URL, nunca do corpo.
const comentarioSchema = z.object({
  texto: z.any().transform((x) => v.texto(x, 4000))
    .refine((s) => s.length > 0, 'Escreva alguma coisa no comentário'),
});

module.exports = { comentarioSchema };
