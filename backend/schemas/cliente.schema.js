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

// POST /api/clientes/:id/servicos
const servicoClienteSchema = z.object({
  nome: z.any().transform((x) => v.texto(x, 80)).refine((s) => s.length > 0, 'Informe o serviço'),
});

// POST /api/clientes/:id/datas  (a data vem de um <input type="date">; vale dia e mes)
const dataClienteSchema = z.object({
  data: z.any().transform((x) => v.dataOuNull(x)).refine((d) => d !== null, 'Informe a data'),
  nome: z.any().transform((x) => v.texto(x, 120)).refine((s) => s.length > 0, 'Informe o nome da data'),
});

module.exports = { criarClienteSchema, atualizarClienteSchema, servicoClienteSchema, dataClienteSchema, CAMPOS };
