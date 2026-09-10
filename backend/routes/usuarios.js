'use strict';

/**
 * Gerenciamento de usuarios, restrito ao Atendimento (papel 'admin').
 * Criar, editar, excluir; definir setor, permissao e, para o Criativo,
 * quais colunas (tipos de tarefa) o membro enxerga.
 *
 * Toda regra vive aqui no backend: o front so desenha a tela.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const repo = require('../data');
const { exigirLogin, exigirAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { comIdValidado } = require('../middleware/params');
const { criarUsuarioSchema, atualizarUsuarioSchema } = require('../schemas/usuario.schema');

const router = express.Router();
// :id sempre numerico (nunca chega NaN no banco)
comIdValidado(router);
router.use(exigirLogin, exigirAdmin);

// Colunas visiveis so fazem sentido no Criativo. Fora dele: sempre null (ve tudo).
// Dentro dele: filtra os ids informados para os que existem no setor; lista
// vazia/ausente = ve todas as colunas.
async function resolverColunasVisiveis(setorId, colunasVisiveis) {
  const setores = await repo.listarSetores();
  const setor = setores.find((s) => s.id === setorId);
  if (!setor || setor.slug !== 'criativo') return null;
  if (!Array.isArray(colunasVisiveis) || !colunasVisiveis.length) return null;
  const cols = await repo.listarColunas(setorId); // admin: todas as colunas do setor
  const validas = new Set(cols.map((c) => c.id));
  const ids = colunasVisiveis.map(Number).filter((id) => validas.has(id));
  return ids.length ? ids : null;
}

async function setorExiste(setorId) {
  const setores = await repo.listarSetores();
  return setores.some((s) => s.id === setorId);
}

// GET /api/usuarios
router.get('/', async (req, res, next) => {
  try {
    res.json({ usuarios: await repo.listarUsuarios() });
  } catch (e) { next(e); }
});

// POST /api/usuarios
router.post('/', validate(criarUsuarioSchema), async (req, res, next) => {
  try {
    const { nome, usuario, senha, setor_id, papel, pode_clientes } = req.body;
    if (!(await setorExiste(setor_id))) return res.status(400).json({ erro: 'Setor inválido' });

    const jaExiste = await repo.buscarUsuarioPorLogin(usuario);
    if (jaExiste) return res.status(409).json({ erro: 'Já existe um usuário com esse login' });

    const colunas_visiveis = await resolverColunasVisiveis(setor_id, req.body.colunas_visiveis);
    const senha_hash = await bcrypt.hash(senha, 10);

    const novo = await repo.criarUsuario({
      nome, usuario, senha_hash, setor_id, papel, colunas_visiveis,
      pode_clientes: !!pode_clientes, ativo: true,
    });
    await registrar(req, {
      tipo: 'criada', entidade: 'usuario', entidade_id: novo.id, titulo: novo.nome,
      setor_id: novo.setor_id, detalhe: `criou o usuário "${novo.usuario}" (${novo.papel})`,
    });
    res.status(201).json({ usuario: novo });
  } catch (e) { next(e); }
});

// PUT /api/usuarios/:id
router.put('/:id', validate(atualizarUsuarioSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const lista = await repo.listarUsuarios();
    const alvo = lista.find((u) => u.id === id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const dados = {};

    if ('nome' in req.body) dados.nome = req.body.nome;

    if ('usuario' in req.body) {
      const outro = await repo.buscarUsuarioPorLogin(req.body.usuario);
      if (outro && outro.id !== id) return res.status(409).json({ erro: 'Já existe um usuário com esse login' });
      dados.usuario = req.body.usuario;
    }

    if ('setor_id' in req.body) {
      if (!(await setorExiste(req.body.setor_id))) return res.status(400).json({ erro: 'Setor inválido' });
      dados.setor_id = req.body.setor_id;
    }

    if ('papel' in req.body && req.body.papel !== alvo.papel) {
      // trava anti-lockout: nao permitir ficar sem admin nem se auto-rebaixar
      if (alvo.papel === 'admin' && req.body.papel !== 'admin') {
        if (alvo.id === req.usuario.id) {
          return res.status(400).json({ erro: 'Você não pode remover o seu próprio acesso de admin' });
        }
        if ((await repo.contarAdmins()) <= 1) {
          return res.status(400).json({ erro: 'É preciso manter ao menos um admin no sistema' });
        }
      }
      dados.papel = req.body.papel;
    }

    if ('pode_clientes' in req.body) dados.pode_clientes = !!req.body.pode_clientes;

    // desativar: mesma trava do rebaixamento. Ninguem se desativa sozinho e o
    // sistema nunca fica sem admin ativo (a conta some do sistema sem apagar
    // o historico dela).
    if ('ativo' in req.body && !!req.body.ativo !== (alvo.ativo !== false)) {
      if (!req.body.ativo) {
        if (alvo.id === req.usuario.id) {
          return res.status(400).json({ erro: 'Você não pode desativar a sua própria conta' });
        }
        if (alvo.papel === 'admin' && (await repo.contarAdmins()) <= 1) {
          return res.status(400).json({ erro: 'É preciso manter ao menos um admin ativo no sistema' });
        }
      }
      dados.ativo = !!req.body.ativo;
    }

    // colunas: recalcula se o setor mudou ou se vieram novas colunas
    if ('colunas_visiveis' in req.body || 'setor_id' in req.body) {
      const setorFinal = ('setor_id' in req.body) ? req.body.setor_id : alvo.setor_id;
      const colunasInformadas = ('colunas_visiveis' in req.body) ? req.body.colunas_visiveis : alvo.colunas_visiveis;
      dados.colunas_visiveis = await resolverColunasVisiveis(setorFinal, colunasInformadas);
    }

    if ('senha' in req.body && req.body.senha) {
      dados.senha_hash = await bcrypt.hash(req.body.senha, 10);
    }

    const atualizado = await repo.atualizarUsuario(id, dados);
    // a senha nunca entra no detalhe: registra so QUE mudou, nunca o valor.
    const campos = Object.keys(dados).map((k) => (k === 'senha_hash' ? 'senha' : k));
    await registrar(req, {
      tipo: 'editada', entidade: 'usuario', entidade_id: atualizado.id, titulo: atualizado.nome,
      setor_id: atualizado.setor_id,
      detalhe: `editou o usuário "${atualizado.usuario}" (${campos.join(', ') || 'sem alteração'})`,
    });
    res.json({ usuario: atualizado });
  } catch (e) { next(e); }
});

// DELETE /api/usuarios/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.usuario.id) return res.status(400).json({ erro: 'Você não pode excluir a sua própria conta' });

    const lista = await repo.listarUsuarios();
    const alvo = lista.find((u) => u.id === id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado' });

    if (alvo.papel === 'admin' && (await repo.contarAdmins()) <= 1) {
      return res.status(400).json({ erro: 'É preciso manter ao menos um admin no sistema' });
    }

    await repo.excluirUsuario(id);
    await registrar(req, {
      tipo: 'excluida', entidade: 'usuario', entidade_id: id, titulo: alvo.nome,
      setor_id: alvo.setor_id, detalhe: `excluiu o usuário "${alvo.usuario}"`,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;