'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

// Valores aceitos nos filtros. Qualquer coisa fora da lista vira null
// (filtro ignorado) em vez de ir parar numa consulta.
const ENTIDADES = ['tarefa', 'cliente', 'usuario', 'setor', 'sessao',
                   'evento', 'briefing', 'prompt', 'acesso'];
const TIPOS = ['criada', 'editada', 'movida', 'concluida', 'excluida',
               'login', 'login_falha', 'login_bloqueio', 'logout', 'senha_vista'];

// Filtros rapidos da tela: cada categoria vira entidade e/ou lista de tipos.
// Fica aqui (e nao no navegador) para valer junto com a paginacao.
const CATEGORIAS = {
  tarefas: { entidade: 'tarefa' },
  acessos: { tipos: ['login', 'login_falha', 'login_bloqueio', 'logout'] },
  falhas: { tipos: ['login_falha'] },
  bloqueios: { tipos: ['login_bloqueio'] },
  cofre: { entidade: 'acesso' },
};

const umDe = (lista) => z.any().transform((x) => {
  const s = String(x ?? '').trim();
  return lista.includes(s) ? s : null;
});

const filtroHistoricoSchema = z.object({
  categoria: umDe(Object.keys(CATEGORIAS)),
  entidade: umDe(ENTIDADES),
  tipo: umDe(TIPOS),
  usuario_id: z.any().transform((x) => v.inteiroOuNull(x)),
  setor: z.any().transform((x) => v.inteiroOuNull(x)),
  cliente: z.any().transform((x) => v.texto(x, 200) || null),
  responsavel: z.any().transform((x) => v.texto(x, 120) || null),
  prioridade: umDe(v.PRIORIDADES),
  de: z.any().transform((x) => v.dataOuNull(x)),
  ate: z.any().transform((x) => v.dataOuNull(x)),
  q: z.any().transform((x) => v.texto(x, 120) || null),
  antes_de: z.any().transform((x) => v.inteiroOuNull(x)), // cursor da proxima pagina
  limit: z.any().transform((x) => {
    const n = v.inteiroOuNull(x);
    if (n === null) return 300;
    return Math.min(Math.max(n, 1), 500);
  }),
}).partial();

module.exports = { filtroHistoricoSchema, ENTIDADES, TIPOS, CATEGORIAS };
