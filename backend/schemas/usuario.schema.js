'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

// papel valido: admin (Atendimento) ou membro
const PAPEIS = ['admin', 'membro'];

const zNome = z.any().transform((x) => v.texto(x, 120));
// login: minusculo, sem espacos, so letras/numeros/. _ -
const zLogin = z.any().transform((x) => String(x ?? '').toLowerCase().trim().replace(/\s+/g, ''));
const zSenha = z.any().transform((x) => String(x ?? ''));
const zSetor = z.any().transform((x) => v.inteiroOuNull(x));
const zPapel = z.any().transform((x) => (PAPEIS.includes(x) ? x : 'membro'));
const zColunas = z.any().transform((x) => v.listaDeInteiros(x));
// booleano tolerante: aceita true/false, "true"/"false", 1/0 (form e JSON)
const zBool = z.any().transform((x) => x === true || x === 1 || x === '1' || x === 'true');

const RE_LOGIN = /^[a-z0-9._-]{2,40}$/;

// POST /api/usuarios  (todos os campos obrigatorios, exceto colunas_visiveis)
const criarUsuarioSchema = z.object({
  nome: zNome.refine((s) => s.length > 0, 'Nome é obrigatório'),
  usuario: zLogin.refine((s) => RE_LOGIN.test(s),
    'Login inválido: use de 2 a 40 caracteres (letras minúsculas, números, ponto, hífen ou underline)'),
  senha: zSenha.refine((s) => s.length >= 6, 'A senha deve ter ao menos 6 caracteres'),
  setor_id: zSetor.refine((n) => n !== null, 'Setor é obrigatório'),
  papel: zPapel,
  colunas_visiveis: zColunas,
  // permissao de cadastrar/editar clientes (o servidor e quem decide isso)
  pode_clientes: zBool,
});

// PUT /api/usuarios/:id  (parcial). senha vazia = mantem a atual.
const atualizarUsuarioSchema = z.object({
  nome: zNome.refine((s) => s.length > 0, 'Nome não pode ficar vazio'),
  usuario: zLogin.refine((s) => RE_LOGIN.test(s),
    'Login inválido: use de 2 a 40 caracteres (letras minúsculas, números, ponto, hífen ou underline)'),
  senha: zSenha, // opcional; se vier vazia, e ignorada na rota
  setor_id: zSetor.refine((n) => n !== null, 'Setor inválido'),
  papel: zPapel,
  colunas_visiveis: zColunas,
  ativo: zBool,          // desativar sem apagar (o historico da pessoa fica)
  pode_clientes: zBool,
}).partial();

module.exports = { criarUsuarioSchema, atualizarUsuarioSchema, PAPEIS };