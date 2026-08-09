'use strict';

/**
 * Teste de integracao (memoria). Sobe a API de verdade numa porta de teste
 * e exercita o fluxo principal + as mudancas desta migracao:
 * rate-limit no login e validacao por schema (zod).
 *
 *   npm test        (com DATABASE_URL vazio -> roda em memoria)
 */

const assert = require('assert');
const { iniciar } = require('../server');

const PORT = 4599;
const BASE = `http://localhost:${PORT}`;

// --- mini cliente com "cookie jar" (mantem a sessao entre requests) ---
function criarCliente() {
  let cookie = '';
  return async function reqc(metodo, url, corpo) {
    const opts = { method: metodo, headers: {} };
    if (cookie) opts.headers.Cookie = cookie;
    if (corpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + url, opts);
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let dados = null; try { dados = await r.json(); } catch (_) {}
    return { status: r.status, dados };
  };
}

let passou = 0;
function ok(nome, cond) {
  assert.ok(cond, 'FALHOU: ' + nome);
  passou++;
  console.log('  ✓ ' + nome);
}

(async () => {
  const servidor = await iniciar(PORT);
  console.log(`\nAPI de teste em ${BASE}\n`);
  try {
    // 1) health
    let r = await (criarCliente())('GET', '/api/health');
    ok('health responde ok + modo memoria', r.status === 200 && r.dados.ok && r.dados.modo === 'memoria');

    // 2) rota nao-API responde 404 (backend virou API pura)
    r = await (criarCliente())('GET', '/');
    ok('rota "/" retorna 404 (sem servir front)', r.status === 404);

    // 3) me sem login -> 401
    const admin = criarCliente();
    r = await admin('GET', '/api/auth/me');
    ok('me sem sessao -> 401', r.status === 401);

    // 4) validacao de schema: login sem senha -> 400 com mensagem
    r = await admin('POST', '/api/auth/login', { usuario: 'admin' });
    ok('login sem senha -> 400 (zod)', r.status === 400 && /usuário e senha/i.test(r.dados.erro));

    // 5) login errado -> 401 generico
    r = await admin('POST', '/api/auth/login', { usuario: 'admin', senha: 'errada' });
    ok('login com senha errada -> 401', r.status === 401);

    // 6) login admin correto
    r = await admin('POST', '/api/auth/login', { usuario: 'admin', senha: 'colodel2026' });
    ok('login admin (admin) -> 200', r.status === 200 && r.dados.ok);

    // 7) me logado
    r = await admin('GET', '/api/auth/me');
    ok('me logado retorna usuario admin', r.status === 200 && r.dados.usuario.papel === 'admin');

    // 8) setores (admin ve todos)
    r = await admin('GET', '/api/setores');
    const setores = r.dados.setores;
    ok('admin ve todos os setores (>=5)', r.status === 200 && setores.length >= 5);
    const criativo = setores.find((s) => s.slug === 'criativo');

    // 9) criar tarefa SEM titulo -> 400 (zod)
    r = await admin('POST', '/api/tarefas', { setor_id: criativo.id, titulo: '   ' });
    ok('criar tarefa sem titulo -> 400 (zod)', r.status === 400 && /título/i.test(r.dados.erro));

    // 10) criar tarefa valida
    r = await admin('POST', '/api/tarefas', {
      setor_id: criativo.id, titulo: 'Tarefa de teste', prioridade: 'alta',
      data_entrega: '2026-12-31',
    });
    ok('criar tarefa valida -> 201', r.status === 201 && r.dados.tarefa.id);
    const tarefaId = r.dados.tarefa.id;

    // 11) colunas do setor + mover tarefa
    r = await admin('GET', `/api/setores/${criativo.id}/colunas`);
    const colunas = r.dados.colunas;
    ok('colunas do criativo carregam', r.status === 200 && colunas.length > 1);
    r = await admin('PATCH', `/api/tarefas/${tarefaId}/mover`, { coluna_id: colunas[1].id });
    ok('mover tarefa para 2a coluna -> 200', r.status === 200 && r.dados.tarefa.coluna_id === colunas[1].id);

    // 12) mover para coluna invalida -> 400
    r = await admin('PATCH', `/api/tarefas/${tarefaId}/mover`, { coluna_id: 999999 });
    ok('mover para coluna invalida -> 400', r.status === 400);

    // 13) historico (admin)
    r = await admin('GET', '/api/tarefas/historico');
    ok('historico lista acoes (criada/movida)', r.status === 200 && r.dados.historico.length >= 2);

    // 14) membro (usuario05) so ve o proprio setor
    const membro = criarCliente();
    await membro('POST', '/api/auth/login', { usuario: 'usuario05', senha: 'colodel2026' });
    r = await membro('GET', '/api/setores');
    ok('membro ve apenas o proprio setor', r.status === 200 && r.dados.setores.length === 1);

    // 15) membro nao pode excluir tarefa -> 403
    r = await membro('DELETE', `/api/tarefas/${tarefaId}`);
    ok('membro nao exclui tarefa -> 403', r.status === 403);

    // 16) admin exclui tarefa -> 200
    r = await admin('DELETE', `/api/tarefas/${tarefaId}`);
    ok('admin exclui tarefa -> 200', r.status === 200 && r.dados.ok);

    // 17) clientes: criar sem empresa -> 400 (zod, via JSON aqui)
    r = await admin('POST', '/api/clientes', { empresa: '' });
    ok('criar cliente sem empresa -> 400 (zod)', r.status === 400 && /empresa/i.test(r.dados.erro));

    // ---- GERENCIAMENTO DE USUARIOS (admin) ----
    // 18) membro nao acessa a gestao de usuarios -> 403
    r = await membro('GET', '/api/usuarios');
    ok('membro nao lista usuarios -> 403', r.status === 403);

    // 19) admin lista usuarios
    r = await admin('GET', '/api/usuarios');
    ok('admin lista usuarios (>=11)', r.status === 200 && r.dados.usuarios.length >= 11
      && r.dados.usuarios.some((u) => u.usuario === 'admin'));

    // 20) criar com senha fraca -> 400
    r = await admin('POST', '/api/usuarios', {
      nome: 'Teste', usuario: 'novoteste', senha: '123', setor_id: criativo.id, papel: 'membro',
    });
    ok('criar usuario com senha curta -> 400', r.status === 400 && /senha/i.test(r.dados.erro));

    // 21) criar usuario do Criativo com colunas visiveis restritas
    const colsCriativo = (await admin('GET', `/api/setores/${criativo.id}/colunas`)).dados.colunas;
    const visiveis = [colsCriativo[0].id, colsCriativo[1].id];
    r = await admin('POST', '/api/usuarios', {
      nome: 'Membro Teste', usuario: 'membroteste', senha: 'senha123',
      setor_id: criativo.id, papel: 'membro', colunas_visiveis: visiveis,
    });
    ok('criar usuario criativo -> 201', r.status === 201 && r.dados.usuario.id
      && r.dados.usuario.colunas_visiveis.length === 2);
    const novoId = r.dados.usuario.id;

    // 22) login duplicado -> 409
    r = await admin('POST', '/api/usuarios', {
      nome: 'Outro', usuario: 'membroteste', senha: 'senha123', setor_id: criativo.id, papel: 'membro',
    });
    ok('criar com login existente -> 409', r.status === 409);

    // 23) novo usuario faz login e enxerga SO as colunas liberadas
    const novoCli = criarCliente();
    r = await novoCli('POST', '/api/auth/login', { usuario: 'membroteste', senha: 'senha123' });
    ok('novo usuario loga com a senha definida', r.status === 200 && r.dados.ok);
    r = await novoCli('GET', `/api/setores/${criativo.id}/colunas`);
    ok('novo usuario ve apenas as 2 colunas liberadas', r.status === 200 && r.dados.colunas.length === 2);

    // 24) editar usuario (renomear)
    r = await admin('PUT', `/api/usuarios/${novoId}`, { nome: 'Membro Renomeado' });
    ok('editar usuario -> 200', r.status === 200 && r.dados.usuario.nome === 'Membro Renomeado');

    // 25) admin nao pode excluir a propria conta -> 400
    const eu = (await admin('GET', '/api/auth/me')).dados.usuario;
    r = await admin('DELETE', `/api/usuarios/${eu.id}`);
    ok('admin nao exclui a propria conta -> 400', r.status === 400);

    // 26) excluir o usuario de teste -> 200
    r = await admin('DELETE', `/api/usuarios/${novoId}`);
    ok('admin exclui usuario -> 200', r.status === 200 && r.dados.ok);

    // 27) rate-limit do login: estoura tentativas erradas -> 429
    const bf = criarCliente();
    let bateu429 = false;
    for (let i = 0; i < 15; i++) {
      const rr = await bf('POST', '/api/auth/login', { usuario: 'ninguem', senha: 'x' });
      if (rr.status === 429) { bateu429 = true; break; }
    }
    ok('rate-limit do login dispara 429 apos varias falhas', bateu429);

    console.log(`\n✅ ${passou} verificacoes passaram.\n`);
    servidor.close();
    process.exit(0);
  } catch (e) {
    console.error('\n❌ ' + e.message + '\n');
    servidor.close();
    process.exit(1);
  }
})();