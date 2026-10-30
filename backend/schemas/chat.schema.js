'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

const TIPOS = ['grupo', 'direta'];

// POST /api/chat/conversas
//   direta: { tipo: 'direta', usuario_id }
//   grupo:  { tipo: 'grupo', nome, membros: [ids] }
const criarConversaSchema = z.object({
  tipo: z.any().transform((x) => (TIPOS.includes(x) ? x : null))
    .refine((t) => t !== null, 'Tipo de conversa inválido'),
  usuario_id: z.any().transform((x) => v.inteiroOuNull(x)),
  nome: z.any().transform((x) => v.texto(x, 80)),
  membros: z.any().transform((x) => v.listaDeInteiros(x)),
}).refine((d) => d.tipo !== 'direta' || d.usuario_id !== null, 'Escolha com quem conversar')
  .refine((d) => d.tipo !== 'grupo' || d.nome.length > 0, 'Dê um nome ao grupo');

// PUT /api/chat/conversas/:id  (so grupo)
const atualizarConversaSchema = z.object({
  nome: z.any().transform((x) => v.texto(x, 80)).refine((s) => s.length > 0, 'O grupo precisa de um nome'),
  membros: z.any().transform((x) => v.listaDeInteiros(x)),
}).partial();

// POST /api/chat/conversas/:id/mensagens  (JSON ou multipart com "arquivo")
const mensagemSchema = z.object({
  texto: z.any().transform((x) => v.texto(x, 4000)),
});

const lidaSchema = z.object({
  ate_id: z.any().transform((x) => v.inteiroOuNull(x) || 0),
});

const paginaMensagensSchema = z.object({
  antes_de: z.any().transform((x) => v.inteiroOuNull(x)),
}).partial();

module.exports = { criarConversaSchema, atualizarConversaSchema, mensagemSchema, lidaSchema, paginaMensagensSchema };
