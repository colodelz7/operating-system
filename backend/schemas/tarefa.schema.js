'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

// Reaproveita as MESMAS funcoes de normalizacao usadas antes, agora
// dentro do zod. Comportamento identico ao codigo manual anterior.
const zTexto = (max) => z.any().transform((x) => v.texto(x, max));
const zInteiroOuNull = z.any().transform((x) => v.inteiroOuNull(x));
const zDataOuNull = z.any().transform((x) => v.dataOuNull(x));
const zPrioridade = z.any().transform((x) => v.prioridade(x));
const zResponsaveis = z.any().transform((x) => v.listaDeInteiros(x));

// POST /api/tarefas
const criarTarefaSchema = z.object({
  setor_id: z.any().transform((x) => v.inteiroOuNull(x))
    .refine((n) => n !== null, 'Setor é obrigatório'),
  titulo: zTexto(200).refine((s) => s.length > 0, 'Título é obrigatório'),
  descricao: zTexto(5000),
  cliente_id: zInteiroOuNull,
  prioridade: zPrioridade,
  coluna_id: zInteiroOuNull,
  data_inicio: zDataOuNull,
  data_entrega: zDataOuNull,
  data_publicacao: zDataOuNull,
  responsaveis: zResponsaveis,
});

// PUT /api/tarefas/:id  (parcial: so os campos presentes sao atualizados)
const atualizarTarefaSchema = z.object({
  titulo: zTexto(200),
  descricao: zTexto(5000),
  cliente_id: zInteiroOuNull,
  prioridade: zPrioridade,
  data_inicio: zDataOuNull,
  data_entrega: zDataOuNull,
  data_publicacao: zDataOuNull,
  responsaveis: zResponsaveis,
}).partial();

// PATCH /api/tarefas/:id/mover
const moverTarefaSchema = z.object({
  coluna_id: zInteiroOuNull,
});

module.exports = { criarTarefaSchema, atualizarTarefaSchema, moverTarefaSchema };
