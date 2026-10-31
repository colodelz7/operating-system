'use strict';

const { z } = require('zod');

// login: usuario e senha obrigatorios. A normalizacao (lowercase/trim do
// usuario) continua na rota, como antes.
const loginSchema = z.object({
  usuario: z.any().optional().transform((v) => String(v ?? '').trim())
    .refine((s) => s.length > 0, 'Informe usuário e senha'),
  senha: z.any().optional().transform((v) => String(v ?? ''))
    .refine((s) => s.length > 0, 'Informe usuário e senha'),
});

module.exports = { loginSchema };
