'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

const CAMPOS = ['empresa', 'razao_social', 'cnpj', 'nicho', 'tamanho', 'cep', 'endereco',
                'complemento', 'cidade', 'estado', 'contato', 'telefone', 'email', 'site', 'instagram'];

const zTexto300 = z.any().transform((x) => v.texto(x, 300));

// Monta um shape com todos os campos texto (aparados em 300 chars).
const shape = {};
CAMPOS.forEach((c) => { shape[c] = zTexto300; });

// POST: empresa obrigatoria. Demais campos opcionais.
const criarClienteSchema = z.object({
  ...shape,
  empresa: zTexto300.refine((s) => s.length > 0, 'Nome da empresa é obrigatório'),
}).partial({
  razao_social: true, cnpj: true, nicho: true, tamanho: true, cep: true, endereco: true,
  complemento: true, cidade: true, estado: true, contato: true, telefone: true,
  email: true, site: true, instagram: true,
});

// PUT: todos opcionais (atualiza so o que veio).
const atualizarClienteSchema = z.object(shape).partial();

module.exports = { criarClienteSchema, atualizarClienteSchema, CAMPOS };
