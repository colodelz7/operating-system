'use strict';

/**
 * Teste de integracao (memoria). Sobe a API de verdade numa porta de teste
 * e exercita o fluxo principal + as protecoes de seguranca:
 * cabecalhos, method override, bloqueio de login, auditoria, permissoes.
 *
 *   npm test        (com DATABASE_URL vazio -> roda em memoria)
 */

const assert = require('assert');
const { iniciar } = require('../server');
const ferramentas = require('../services/assistente/ferramentas');
const { sweepRecorrencias } = require('../services/recorrencia');
const bloqueioLogin = require('../middleware/bloqueioLogin');

const PORT = 4599;
const BASE = `http://localhost:${PORT}`;
const SENHA = 'colodel';

// --- mini cliente com "cookie jar" (mantem a sessao entre requests) ---
function criarCliente() {
  let cookie = '';
  async function reqc(metodo, url, corpo, headersExtras) {
    const opts = { method: metodo, headers: { ...(headersExtras || {}) } };
    if (cookie) opts.headers.Cookie = cookie;
    if (corpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + url, opts);
    const sc = r.headers.get('set-cookie');
    if (sc) { cookie = sc.split(';')[0]; reqc.cookie = cookie; }
    let dados = null; try { dados = await r.json(); } catch (_) {}
    return { status: r.status, dados, headers: r.headers };
  }
  reqc.cookie = '';
  return reqc;
}

// envia PUT/PATCH/DELETE do jeito que o front envia quando o WAF bloqueia
// esses verbos: POST + X-HTTP-Method-Override.
function comOverride(cli) {
  return (metodo, url, corpo) => cli('POST', url, corpo, { 'X-HTTP-Method-Override': metodo });
}

let passou = 0;
function ok(nome, cond) {
  assert.ok(cond, 'FALHOU: ' + nome);
  passou++;
  console.log('  ✓ ' + nome);
}

(async () => {
  const servidor = await iniciar(PORT, '127.0.0.1');
  console.log(`\nAPI de teste em ${BASE}\n`);
  try {
    // 1) health
    let r = await (criarCliente())('GET', '/api/health');
    // a mesma suite roda nos dois repositorios: sem banco (memoria) e com
    // DATABASE_URL (postgres). E assim que a paridade fica provada.
    ok('health responde ok + modo do repositorio',
      r.status === 200 && r.dados.ok && ['memoria', 'postgres'].includes(r.dados.modo));
    console.log('    (repositorio em uso: ' + r.dados.modo + ')');

    // 2) cabecalhos de seguranca em toda resposta
    ok('cabecalhos de seguranca presentes (CSP, nosniff, frame, referrer, permissions)',
      /default-src 'none'/.test(r.headers.get('content-security-policy') || '')
      && r.headers.get('x-content-type-options') === 'nosniff'
      && r.headers.get('x-frame-options') === 'DENY'
      && r.headers.get('referrer-policy') === 'no-referrer'
      && /camera=\(\)/.test(r.headers.get('permissions-policy') || '')
      && !r.headers.get('x-powered-by'));

    // 3) rota nao-API responde 404 (backend virou API pura)
    r = await (criarCliente())('GET', '/');
    ok('rota "/" retorna 404 (sem servir front)', r.status === 404);

    // 4) me sem login -> 401
    const admin = criarCliente();
    r = await admin('GET', '/api/auth/me');
    ok('me sem sessao -> 401', r.status === 401);

    // 5) validacao de schema: login sem senha -> 400 com mensagem
    r = await admin('POST', '/api/auth/login', { usuario: 'admin' });
    ok('login sem senha -> 400 (zod)', r.status === 400 && /usuário e senha/i.test(r.dados.erro));

    // 6) login errado -> 401 generico
    r = await admin('POST', '/api/auth/login', { usuario: 'admin', senha: 'errada' });
    ok('login com senha errada -> 401', r.status === 401);

    // 7) login admin correto (zera a contagem de falhas)
    r = await admin('POST', '/api/auth/login', { usuario: 'admin', senha: SENHA });
    ok('login admin (admin) -> 200', r.status === 200 && r.dados.ok);
    const putA = comOverride(admin);

    // 8) me logado
    r = await admin('GET', '/api/auth/me');
    ok('me logado retorna usuario admin', r.status === 200 && r.dados.usuario.papel === 'admin');

    // 9) setores (admin ve todos)
    r = await admin('GET', '/api/setores');
    const setores = r.dados.setores;
    ok('admin ve todos os setores (>=5)', r.status === 200 && setores.length >= 5);
    const criativo = setores.find((s) => s.slug === 'criativo');

    // 10) criar tarefa SEM titulo -> 400 (zod)
    r = await admin('POST', '/api/tarefas', { setor_id: criativo.id, titulo: '   ' });
    ok('criar tarefa sem titulo -> 400 (zod)', r.status === 400 && /título/i.test(r.dados.erro));

    // 11) criar tarefa valida
    r = await admin('POST', '/api/tarefas', {
      setor_id: criativo.id, titulo: 'Tarefa de teste', prioridade: 'alta',
      data_entrega: '2026-12-31',
    });
    ok('criar tarefa valida -> 201', r.status === 201 && r.dados.tarefa.id);
    const tarefaId = r.dados.tarefa.id;

    // 12) colunas do setor + mover tarefa (PATCH direto)
    r = await admin('GET', `/api/setores/${criativo.id}/colunas`);
    const colunas = r.dados.colunas;
    ok('colunas do criativo carregam', r.status === 200 && colunas.length > 1);
    r = await admin('PATCH', `/api/tarefas/${tarefaId}/mover`, { coluna_id: colunas[1].id });
    ok('mover tarefa para 2a coluna -> 200', r.status === 200 && r.dados.tarefa.coluna_id === colunas[1].id);

    // ---- METHOD OVERRIDE (o front manda POST quando o WAF barra o verbo) ----
    // 13) editar via POST + X-HTTP-Method-Override: PUT
    r = await putA('PUT', `/api/tarefas/${tarefaId}`, { titulo: 'Editada pelo override' });
    ok('PUT via override edita a tarefa', r.status === 200 && r.dados.tarefa.titulo === 'Editada pelo override');

    // 14) mover via POST + override: PATCH
    r = await putA('PATCH', `/api/tarefas/${tarefaId}/mover`, { coluna_id: colunas[2].id });
    ok('PATCH via override move o card do kanban', r.status === 200 && r.dados.tarefa.coluna_id === colunas[2].id);

    // 15) override so vale para PUT/PATCH/DELETE: GET nao passa
    r = await admin('POST', '/api/auth/me', undefined, { 'X-HTTP-Method-Override': 'GET' });
    ok('override com GET e ignorado (segue POST -> 404)', r.status === 404);

    // ---- ANTI-CSRF (checagem de origem nas escritas) ----
    r = await admin('POST', '/api/tarefas',
      { setor_id: criativo.id, titulo: 'Veio de outro site' },
      { Origin: 'https://site-malicioso.example' });
    ok('escrita com Origin de outro site -> 403', r.status === 403 && /origem/i.test(r.dados.erro));

    r = await admin('POST', '/api/tarefas',
      { setor_id: criativo.id, titulo: 'Veio da propria origem' },
      { Origin: BASE });
    ok('escrita com Origin da propria origem passa', r.status === 201);
    await putA('DELETE', `/api/tarefas/${r.dados.tarefa.id}`);

    r = await admin('GET', '/api/tarefas', undefined, { Origin: 'https://site-malicioso.example' });
    ok('leitura com Origin de fora nao e bloqueada (so escrita e)', r.status === 200);

    // 16) mover para coluna invalida -> 400
    r = await admin('PATCH', `/api/tarefas/${tarefaId}/mover`, { coluna_id: 999999 });
    ok('mover para coluna invalida -> 400', r.status === 400);

    // 17) membro (morning) so ve o proprio setor
    const membro = criarCliente();
    await membro('POST', '/api/auth/login', { usuario: 'morning', senha: SENHA });
    r = await membro('GET', '/api/setores');
    ok('membro ve apenas o proprio setor', r.status === 200 && r.dados.setores.length === 1);

    // 18) membro nao pode excluir tarefa -> 403 (inclusive via override)
    r = await comOverride(membro)('DELETE', `/api/tarefas/${tarefaId}`);
    ok('membro nao exclui tarefa nem via override -> 403', r.status === 403);

    // 19) membro nao le a trilha de auditoria -> 403
    r = await membro('GET', '/api/historico');
    ok('membro nao acessa o historico -> 403', r.status === 403);

    // 20) admin exclui tarefa via override -> 200
    r = await putA('DELETE', `/api/tarefas/${tarefaId}`);
    ok('DELETE via override exclui a tarefa', r.status === 200 && r.dados.ok);

    // ---- TRILHA DE AUDITORIA ----
    // 21) eventos de tarefa gravados com autor, IP e navegador
    r = await admin('GET', '/api/historico?entidade=tarefa');
    const hTarefas = r.dados.historico;
    ok('historico de tarefas registra criacao/edicao/exclusao',
      r.status === 200 && hTarefas.some((h) => h.tipo === 'criada')
      && hTarefas.some((h) => h.tipo === 'editada') && hTarefas.some((h) => h.tipo === 'excluida'));
    ok('registro traz autor, IP e navegador vindos do servidor',
      !!hTarefas[0].usuario_nome && !!hTarefas[0].ip && typeof hTarefas[0].user_agent === 'string');

    // 22) acessos (login e senha errada) tambem entram na trilha
    r = await admin('GET', '/api/historico?entidade=sessao');
    const hSessao = r.dados.historico;
    ok('historico registra login e tentativa de senha errada',
      hSessao.some((h) => h.tipo === 'login') && hSessao.some((h) => h.tipo === 'login_falha'));

    // 23) filtros do historico (tipo e busca livre)
    r = await admin('GET', '/api/historico?tipo=login');
    ok('filtro por acao devolve so aquele tipo',
      r.status === 200 && r.dados.historico.length > 0 && r.dados.historico.every((h) => h.tipo === 'login'));
    r = await admin('GET', '/api/historico?q=override');
    ok('busca livre encontra pelo titulo do evento',
      r.status === 200 && r.dados.historico.some((h) => /override/i.test(h.titulo || '')));

    // 24) clientes: criar sem empresa -> 400 (zod, via JSON aqui)
    r = await admin('POST', '/api/clientes', { empresa: '' });
    ok('criar cliente sem empresa -> 400 (zod)', r.status === 400 && /empresa/i.test(r.dados.erro));

    // 25) ciclo do cliente auditado (criar -> editar -> excluir)
    r = await admin('POST', '/api/clientes', { empresa: 'Cliente de Teste' });
    const clienteId = r.dados.cliente.id;
    await putA('PUT', `/api/clientes/${clienteId}`, { nicho: 'Serviços' });
    r = await putA('DELETE', `/api/clientes/${clienteId}`);
    ok('cliente criado, editado e excluido via override', r.status === 200 && r.dados.ok);
    r = await admin('GET', '/api/historico?entidade=cliente');
    ok('historico registra o ciclo do cliente',
      ['criada', 'editada', 'excluida'].every((t) => r.dados.historico.some((h) => h.tipo === t)));

    // 26) upload: path traversal recusado ao servir logo
    r = await admin('GET', '/api/clientes/logo/..%2F..%2Fpackage.json');
    ok('logo com ../ no nome -> recusado (nao serve arquivo do projeto)', r.status === 400 || r.status === 404);

    // ---- GERENCIAMENTO DE USUARIOS (admin) ----
    // 27) membro nao acessa a gestao de usuarios -> 403
    r = await membro('GET', '/api/usuarios');
    ok('membro nao lista usuarios -> 403', r.status === 403);

    // 28) admin lista os 3 usuarios semeados
    r = await admin('GET', '/api/usuarios');
    ok('admin lista usuarios (admin, colodel, morning)',
      r.status === 200 && r.dados.usuarios.length === 3
      && ['admin', 'colodel', 'morning'].every((n) => r.dados.usuarios.some((u) => u.usuario === n)));

    // 29) criar com senha fraca -> 400
    r = await admin('POST', '/api/usuarios', {
      nome: 'Teste', usuario: 'novoteste', senha: '123', setor_id: criativo.id, papel: 'membro',
    });
    ok('criar usuario com senha curta -> 400', r.status === 400 && /senha/i.test(r.dados.erro));

    // 30) criar usuario do Criativo com colunas visiveis restritas
    const colsCriativo = (await admin('GET', `/api/setores/${criativo.id}/colunas`)).dados.colunas;
    const visiveis = [colsCriativo[0].id, colsCriativo[1].id];
    r = await admin('POST', '/api/usuarios', {
      nome: 'Membro Teste', usuario: 'membroteste', senha: 'senha123',
      setor_id: criativo.id, papel: 'membro', colunas_visiveis: visiveis,
    });
    ok('criar usuario criativo -> 201', r.status === 201 && r.dados.usuario.id
      && r.dados.usuario.colunas_visiveis.length === 2);
    const novoId = r.dados.usuario.id;

    // 31) login duplicado -> 409
    r = await admin('POST', '/api/usuarios', {
      nome: 'Outro', usuario: 'membroteste', senha: 'senha123', setor_id: criativo.id, papel: 'membro',
    });
    ok('criar com login existente -> 409', r.status === 409);

    // 32) novo usuario faz login e enxerga SO as colunas liberadas
    const novoCli = criarCliente();
    r = await novoCli('POST', '/api/auth/login', { usuario: 'membroteste', senha: 'senha123' });
    ok('novo usuario loga com a senha definida', r.status === 200 && r.dados.ok);
    r = await novoCli('GET', `/api/setores/${criativo.id}/colunas`);
    ok('novo usuario ve apenas as 2 colunas liberadas', r.status === 200 && r.dados.colunas.length === 2);

    // 33) editar usuario via override (renomear)
    r = await putA('PUT', `/api/usuarios/${novoId}`, { nome: 'Membro Renomeado' });
    ok('editar usuario via override -> 200', r.status === 200 && r.dados.usuario.nome === 'Membro Renomeado');

    // 34) promover e rebaixar: efeito imediato na sessao que ja estava aberta
    await putA('PUT', `/api/usuarios/${novoId}`, { papel: 'admin' });
    r = await novoCli('GET', '/api/usuarios');
    ok('promocao a admin vale na hora (sem novo login)', r.status === 200);
    await putA('PUT', `/api/usuarios/${novoId}`, { papel: 'membro' });
    r = await novoCli('GET', '/api/usuarios');
    ok('rebaixamento vale na hora, na mesma sessao -> 403', r.status === 403);

    // 35) admin nao pode excluir a propria conta -> 400
    const eu = (await admin('GET', '/api/auth/me')).dados.usuario;
    r = await putA('DELETE', `/api/usuarios/${eu.id}`);
    ok('admin nao exclui a propria conta -> 400', r.status === 400);

    // 36) trava anti-lockout: o sistema nunca fica sem admin ativo
    const outroAdmin = (await admin('GET', '/api/usuarios')).dados.usuarios
      .find((u) => u.papel === 'admin' && u.id !== eu.id);
    r = await putA('PUT', `/api/usuarios/${outroAdmin.id}`, { papel: 'membro' });
    ok('rebaixar o penultimo admin ainda e permitido', r.status === 200);
    r = await putA('PUT', `/api/usuarios/${eu.id}`, { papel: 'membro' });
    ok('nao da para remover o proprio acesso de admin -> 400', r.status === 400);
    r = await putA('DELETE', `/api/usuarios/${outroAdmin.id}`);
    ok('excluir usuario ja rebaixado -> 200', r.status === 200);
    r = await admin('POST', '/api/usuarios', {
      nome: 'Colodel', usuario: 'colodel', senha: SENHA, setor_id: 1, papel: 'admin',
    });
    ok('recria o segundo admin -> 201', r.status === 201);

    // 37) exclusao do usuario de teste auditada
    r = await putA('DELETE', `/api/usuarios/${novoId}`);
    ok('admin exclui usuario -> 200', r.status === 200 && r.dados.ok);
    r = await admin('GET', '/api/historico?entidade=usuario');
    ok('historico registra criacao/edicao/exclusao de usuario',
      ['criada', 'editada', 'excluida'].every((t) => r.dados.historico.some((h) => h.tipo === t)));

    // ---- ASSISTENTE (ColodelBot) ----
    // O modelo nao entra aqui: o que importa para seguranca e a camada que
    // executa a acao, que chama a propria API com a sessao de quem conversa.
    // Um "req" de mentira basta para exercita-la.
    const reqFalso = (cookie) => ({
      headers: { cookie },
      get: (h) => (String(h).toLowerCase() === 'user-agent' ? 'ColodelBot/teste' : ''),
      ip: '127.0.0.1',
      socket: { localPort: PORT },
    });

    // 41) status exige sessao
    r = await (criarCliente())('GET', '/api/assistente/status');
    ok('status do assistente sem sessao -> 401', r.status === 401);

    // 42) status logado responde se o assistente esta configurado
    r = await admin('GET', '/api/assistente/status');
    ok('status do assistente responde disponivel/modelo',
      r.status === 200 && typeof r.dados.disponivel === 'boolean' && !!r.dados.modelo);

    // 43) ferramenta de criacao age como o admin
    let res = await ferramentas.executar('criar_tarefa', {
      setor_id: criativo.id, titulo: 'Demanda criada pelo bot', prioridade: 'alta',
      data_entrega: '2026-12-20',
    }, reqFalso(admin.cookie));
    ok('bot cria tarefa com a sessao do admin', res.ok === true && res.tarefa && res.tarefa.id);
    const tarefaBot = res.tarefa.id;

    // 44) o bot herda as permissoes de quem conversa: membro nao cria fora do setor
    const outroSetor = setores.find((s) => s.slug === 'desenvolvimento');
    res = await ferramentas.executar('criar_tarefa', {
      setor_id: outroSetor.id, titulo: 'Nao deveria existir',
    }, reqFalso(membro.cookie));
    ok('bot do membro nao cria em outro setor -> recusado',
      res.ok === false && res.status === 403);

    // 45) exclusao sem confirmacao nem chega na API
    res = await ferramentas.executar('excluir_tarefa', { id: tarefaBot }, reqFalso(admin.cookie));
    ok('bot recusa exclusao sem confirmacao explicita',
      !res.ok && /confirm/i.test(res.erro || ''));

    // 46) membro confirmando tambem nao exclui (permissao vem da sessao)
    res = await ferramentas.executar('excluir_tarefa', { id: tarefaBot, confirmar: true }, reqFalso(membro.cookie));
    ok('bot do membro nao exclui tarefa -> 403', res.ok === false && res.status === 403);

    // 47) admin confirmando exclui de verdade
    res = await ferramentas.executar('excluir_tarefa', { id: tarefaBot, confirmar: true }, reqFalso(admin.cookie));
    ok('bot do admin exclui quando confirmado', res.ok === true);

    // 48) tudo que o bot fez ficou marcado na auditoria
    r = await admin('GET', '/api/historico?q=ColodelBot');
    ok('auditoria marca as acoes feitas pelo ColodelBot',
      r.status === 200 && r.dados.historico.length >= 2
      && r.dados.historico.every((h) => /pelo ColodelBot/.test(h.detalhe || '')));

    // ---- CONTA DESATIVADA e PERMISSAO DE CLIENTES ----
    // 49) cria uma conta so para desativar
    r = await admin('POST', '/api/usuarios', {
      nome: 'Vai Sair', usuario: 'vaisair', senha: 'senha123',
      setor_id: criativo.id, papel: 'membro',
    });
    ok('usuario de teste criado ja ativo', r.status === 201 && r.dados.usuario.ativo === true);
    const saindoId = r.dados.usuario.id;

    // 50) essa pessoa loga normalmente
    const saindo = criarCliente();
    r = await saindo('POST', '/api/auth/login', { usuario: 'vaisair', senha: 'senha123' });
    ok('conta ativa entra normalmente', r.status === 200 && r.dados.ok);
    r = await saindo('GET', '/api/tarefas');
    ok('conta ativa acessa a API', r.status === 200);

    // 51) admin desativa: a sessao JA ABERTA cai na proxima requisicao
    r = await putA('PUT', `/api/usuarios/${saindoId}`, { ativo: false });
    ok('admin desativa a conta -> 200', r.status === 200 && r.dados.usuario.ativo === false);
    r = await saindo('GET', '/api/tarefas');
    ok('sessao aberta da conta desativada cai na hora -> 401', r.status === 401);

    // 52) e nao consegue mais entrar, mesmo com a senha certa
    const tentando = criarCliente();
    r = await tentando('POST', '/api/auth/login', { usuario: 'vaisair', senha: 'senha123' });
    ok('conta desativada nao faz login -> 401', r.status === 401);

    // 53) a tentativa fica na auditoria
    r = await admin('GET', '/api/historico?q=desativada');
    ok('auditoria registra tentativa de entrar com conta desativada',
      r.status === 200 && r.dados.historico.length >= 1);

    // 54) reativar devolve o acesso
    r = await putA('PUT', `/api/usuarios/${saindoId}`, { ativo: true });
    ok('reativar a conta -> 200', r.status === 200 && r.dados.usuario.ativo === true);
    r = await tentando('POST', '/api/auth/login', { usuario: 'vaisair', senha: 'senha123' });
    ok('conta reativada entra de novo', r.status === 200);

    // 55) ninguem desativa a propria conta
    r = await putA('PUT', `/api/usuarios/${eu.id}`, { ativo: false });
    ok('admin nao desativa a propria conta -> 400', r.status === 400);

    // 56) e o sistema nao fica sem admin ativo
    const admins = (await admin('GET', '/api/usuarios')).dados.usuarios.filter((u) => u.papel === 'admin' && u.ativo);
    if (admins.length === 1) {
      r = await putA('PUT', `/api/usuarios/${admins[0].id}`, { ativo: false });
      ok('nao da para desativar o unico admin ativo -> 400', r.status === 400);
    } else {
      const outro = admins.find((u) => u.id !== eu.id);
      await putA('PUT', `/api/usuarios/${outro.id}`, { ativo: false });
      r = await putA('PUT', `/api/usuarios/${eu.id}`, { ativo: false });
      ok('nao da para desativar o ultimo admin ativo -> 400', r.status === 400);
      await putA('PUT', `/api/usuarios/${outro.id}`, { ativo: true });
    }

    // 57) limpa o usuario de teste
    r = await putA('DELETE', `/api/usuarios/${saindoId}`);
    ok('exclui o usuario de teste -> 200', r.status === 200);

    // ---- PERMISSAO DE CLIENTES (antes era decidida so no front) ----
    // 58) membro do Criativo sem a permissao nao cria cliente
    r = await membro('POST', '/api/clientes', { empresa: 'Cliente Proibido' });
    ok('membro sem permissao nao cria cliente -> 403', r.status === 403);

    // 59) nem edita
    const alvoCliente = (await admin('GET', '/api/clientes')).dados.clientes[0];
    r = await comOverride(membro)('PUT', `/api/clientes/${alvoCliente.id}`, { nicho: 'Invadido' });
    ok('membro sem permissao nao edita cliente -> 403', r.status === 403);

    // 60) com a permissao ligada pelo admin, passa a poder
    const idMembro = (await membro('GET', '/api/auth/me')).dados.usuario.id;
    await putA('PUT', `/api/usuarios/${idMembro}`, { pode_clientes: true });
    r = await membro('POST', '/api/clientes', { empresa: 'Cliente Permitido' });
    ok('com pode_clientes o membro cria cliente -> 201', r.status === 201);
    const criadoPeloMembro = r.dados.cliente.id;

    // 61) mas excluir continua sendo so do admin
    r = await comOverride(membro)('DELETE', `/api/clientes/${criadoPeloMembro}`);
    ok('membro com permissao ainda nao exclui cliente -> 403', r.status === 403);
    await putA('DELETE', `/api/clientes/${criadoPeloMembro}`);
    await putA('PUT', `/api/usuarios/${idMembro}`, { pode_clientes: false });

    // 62) a permissao volta a valer depois de desligada
    r = await membro('POST', '/api/clientes', { empresa: 'Cliente Proibido de Novo' });
    ok('permissao desligada volta a barrar -> 403', r.status === 403);

    // ---- COMENTARIOS, DUPLICAR, RECORRENCIA E RESUMO ----
    const hoje = new Date().toISOString().slice(0, 10);
    const emDias = (dias) => {
      const d = new Date(hoje + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + dias);
      return d.toISOString().slice(0, 10);
    };

    // 49) tarefa que repete toda semana
    r = await admin('POST', '/api/tarefas', {
      setor_id: criativo.id, titulo: 'Post semanal', data_entrega: hoje, recorrencia: 'semanal',
    });
    ok('criar tarefa recorrente guarda a frequencia',
      r.status === 201 && r.dados.tarefa.recorrencia === 'semanal');
    const serie = r.dados.tarefa.id;

    // 50) frequencia invalida vira "nao repete" em vez de erro obscuro
    r = await admin('POST', '/api/tarefas', {
      setor_id: criativo.id, titulo: 'Frequencia estranha', recorrencia: 'a cada lua cheia',
    });
    ok('frequencia desconhecida vira sem recorrencia',
      r.status === 201 && r.dados.tarefa.recorrencia === null);
    await putA('DELETE', `/api/tarefas/${r.dados.tarefa.id}`);

    // 51) comentar
    r = await admin('POST', `/api/tarefas/${serie}/comentarios`, { texto: 'Combinado com o cliente.' });
    ok('comentar na tarefa -> 201 com autor da sessao',
      r.status === 201 && r.dados.comentario.texto === 'Combinado com o cliente.'
      && r.dados.comentario.usuario_nome === 'Administrador');
    const comentarioId = r.dados.comentario.id;

    // 52) comentario vazio nao passa
    r = await admin('POST', `/api/tarefas/${serie}/comentarios`, { texto: '   ' });
    ok('comentario vazio -> 400', r.status === 400);

    // 53) a tarefa passa a contar os comentarios
    r = await admin('GET', `/api/tarefas/${serie}`);
    ok('tarefa traz a contagem de comentarios', r.dados.tarefa.comentarios === 1);

    // 54) membro de outro setor nao le nem comenta
    r = await membro('GET', `/api/tarefas/${serie}/comentarios`);
    const podeVer = r.status === 200; // morning e do Criativo, entao ve esta
    ok('membro do proprio setor le os comentarios', podeVer);

    const setorDistante = setores.find((s) => s.slug === 'desenvolvimento');
    r = await admin('POST', '/api/tarefas', { setor_id: setorDistante.id, titulo: 'Fora do alcance do membro' });
    const tarefaOutroSetor = r.dados.tarefa.id;
    r = await membro('POST', `/api/tarefas/${tarefaOutroSetor}/comentarios`, { texto: 'nao deveria entrar' });
    ok('membro nao comenta em tarefa de outro setor -> 403', r.status === 403);

    // 55) so o autor (ou admin) apaga
    r = await membro('POST', `/api/tarefas/${serie}/comentarios`, { texto: 'comentario do membro' });
    const comentarioDoMembro = r.dados.comentario.id;
    r = await comOverride(membro)('DELETE', `/api/tarefas/${serie}/comentarios/${comentarioId}`);
    ok('membro nao apaga comentario de outra pessoa -> 403', r.status === 403);
    r = await comOverride(membro)('DELETE', `/api/tarefas/${serie}/comentarios/${comentarioDoMembro}`);
    ok('cada um apaga o proprio comentario', r.status === 200);
    r = await putA('DELETE', `/api/tarefas/${serie}/comentarios/${comentarioId}`);
    ok('admin apaga comentario de qualquer pessoa', r.status === 200);

    // 56) duplicar
    r = await admin('POST', `/api/tarefas/${serie}/duplicar`, {});
    ok('duplicar cria copia com "(cópia)" no titulo',
      r.status === 201 && /\(cópia\)/.test(r.dados.tarefa.titulo));
    ok('a copia nao herda recorrencia nem comentarios',
      r.dados.tarefa.recorrencia === null && !r.dados.tarefa.comentarios);
    const copiaId = r.dados.tarefa.id;
    await putA('DELETE', `/api/tarefas/${copiaId}`);

    // 57) concluir a recorrente cria a proxima ocorrencia
    const colConclusao = colunas.find((c) => c.e_conclusao);
    r = await admin('PATCH', `/api/tarefas/${serie}/mover`, { coluna_id: colConclusao.id });
    ok('concluir tarefa recorrente ja cria a proxima',
      r.status === 200 && r.dados.recorrente && r.dados.recorrente.id !== serie);
    ok('a proxima ocorrencia cai uma semana depois',
      r.dados.recorrente.data_entrega === emDias(7));
    ok('a proxima ocorrencia mantem a frequencia e aponta para a origem',
      r.dados.recorrente.recorrencia === 'semanal' && r.dados.recorrente.recorrencia_origem_id === serie);
    const proximaId = r.dados.recorrente.id;

    // 58) rodar a varredura de novo NAO duplica a serie
    const antesDaVarredura = (await admin('GET', `/api/tarefas?setor=${criativo.id}`)).dados.tarefas.length;
    await sweepRecorrencias();
    await sweepRecorrencias();
    const depoisDaVarredura = (await admin('GET', `/api/tarefas?setor=${criativo.id}`)).dados.tarefas.length;
    ok('varredura repetida nao duplica a serie', antesDaVarredura === depoisDaVarredura);

    // 59) a tarefa concluida aponta para a que ela gerou
    r = await admin('GET', `/api/tarefas/${serie}`);
    ok('tarefa concluida guarda qual ocorrencia gerou', r.dados.tarefa.recorrencia_gerou_id === proximaId);

    // 60) serie com prazo final encerra sozinha
    r = await admin('POST', '/api/tarefas', {
      setor_id: criativo.id, titulo: 'Serie que termina', data_entrega: hoje,
      recorrencia: 'semanal', recorrencia_ate: emDias(3),
    });
    const serieCurta = r.dados.tarefa.id;
    r = await admin('PATCH', `/api/tarefas/${serieCurta}/mover`, { coluna_id: colConclusao.id });
    ok('serie nao gera ocorrencia depois do prazo final', r.status === 200 && !r.dados.recorrente);
    await putA('DELETE', `/api/tarefas/${serieCurta}`);

    // 61) resumo do dia
    r = await admin('GET', '/api/resumo-dia');
    ok('resumo do dia responde com totais e listas',
      r.status === 200 && r.dados.data === hoje
      && typeof r.dados.totais.abertas === 'number'
      && Array.isArray(r.dados.atrasadas));
    const resumoAdmin = r.dados;
    r = await membro('GET', '/api/resumo-dia');
    ok('resumo do membro cobre so o setor dele',
      r.status === 200 && r.dados.escopo !== resumoAdmin.escopo
      && r.dados.totais.abertas <= resumoAdmin.totais.abertas);

    // 62) previa de anexo respeita sessao e id
    r = await (criarCliente())('GET', '/api/anexos/1/preview');
    ok('previa de anexo sem sessao -> 401', r.status === 401);
    r = await admin('GET', '/api/anexos/999999/preview');
    ok('previa de anexo inexistente -> 404', r.status === 404);
    r = await admin('GET', '/api/anexos/abc/preview');
    ok('previa com id nao numerico -> 400', r.status === 400);

    // limpeza das tarefas criadas neste bloco
    await putA('DELETE', `/api/tarefas/${proximaId}`);
    await putA('DELETE', `/api/tarefas/${serie}`);
    await putA('DELETE', `/api/tarefas/${tarefaOutroSetor}`);

    // ---- TROCA DE SENHA DERRUBA AS SESSOES ABERTAS ----
    // Quem troca a senha porque desconfia de invasao precisa expulsar quem
    // esta usando a sessao roubada. Antes disso, a sessao antiga seguia viva.
    const sessaoAntiga = criarCliente();
    await sessaoAntiga('POST', '/api/auth/login', { usuario: 'colodel', senha: SENHA });
    const idColodel = (await sessaoAntiga('GET', '/api/auth/me')).dados.usuario.id;
    ok('sessao aberta funciona antes da troca',
      (await sessaoAntiga('GET', '/api/auth/me')).status === 200);

    await putA('PUT', `/api/usuarios/${idColodel}`, { senha: 'senha-nova-123' });
    r = await sessaoAntiga('GET', '/api/auth/me');
    ok('sessao aberta cai depois da troca de senha', r.status === 401);

    const sessaoNova = criarCliente();
    r = await sessaoNova('POST', '/api/auth/login', { usuario: 'colodel', senha: 'senha-nova-123' });
    ok('a senha nova entra normalmente', r.status === 200);
    r = await sessaoNova('GET', '/api/auth/me');
    ok('a sessao criada depois da troca continua valendo', r.status === 200);
    await putA('PUT', `/api/usuarios/${idColodel}`, { senha: SENHA });

    // ---- BLOQUEIO POR ORIGEM, NAO POR CONTA ----
    // O contador que trava e o par conta+origem. Isso impede que um estranho
    // tranque a conta de outra pessoa so errando a senha de proposito, que
    // era o comportamento anterior.
    const IP_ATACANTE = '203.0.113.10';
    const IP_DONO = '198.51.100.20';

    for (let i = 0; i < 5; i++) await bloqueioLogin.registrarFalha(IP_ATACANTE, 'admin');

    let st = await bloqueioLogin.estado(IP_ATACANTE, 'admin');
    ok('quem erra a senha trava a propria origem', st.bloqueado === true);

    st = await bloqueioLogin.estado(IP_DONO, 'admin');
    ok('o dono da conta, vindo de outra origem, continua livre', st.bloqueado === false);

    st = await bloqueioLogin.estado(IP_ATACANTE, 'colodel');
    ok('a origem travada nao entra em nenhuma conta', st.bloqueado === true);

    // Ataque distribuido: uma origem nova a cada tentativa, entao nenhuma
    // origem chega ao limite. A conta acumula falhas, e o sistema avisa sem
    // travar ninguem (travar aqui seria justamente a porta para o abuso).
    let ultimo = null;
    for (let i = 0; i < 12; i++) ultimo = await bloqueioLogin.registrarFalha(`192.0.2.${i}`, 'colodel');
    ok('falhas espalhadas viram alerta de ataque distribuido', ultimo.ataqueDistribuido === true);
    ok('mesmo sob ataque distribuido, a conta nao e travada para o dono',
      (await bloqueioLogin.estado(IP_DONO, 'colodel')).bloqueado === false);

    await bloqueioLogin.limpar(IP_ATACANTE, 'admin');
    st = await bloqueioLogin.estado(IP_ATACANTE, 'admin');
    ok('acertar a senha limpa a contagem daquela origem', st.bloqueado === false);

    // ---- TEMPO DE RESPOSTA DO LOGIN ----
    // Conta inexistente precisa custar o mesmo que conta real, senao o
    // relogio entrega quais logins existem.
    // limpa a contagem entre as medidas: senao a terceira tentativa cai no
    // bloqueio, responde na hora e a comparacao de tempo perde o sentido
    const medir = async (conta) => {
      await bloqueioLogin.limpar('127.0.0.1', conta);
      const cli = criarCliente();
      const t0 = process.hrtime.bigint();
      await cli('POST', '/api/auth/login', { usuario: conta, senha: 'senha-qualquer-errada' });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      await bloqueioLogin.limpar('127.0.0.1', conta);
      return ms;
    };
    const tInexistente = Math.min(await medir('nao_existe_1'), await medir('nao_existe_2'));
    const tExistente = Math.min(await medir('morning'), await medir('morning'));
    const diferenca = Math.abs(tExistente - tInexistente);
    ok(`login de conta inexistente custa o mesmo que o de conta real (diferenca ${diferenca.toFixed(0)}ms)`,
      diferenca < Math.max(40, tExistente * 0.5));

    // ---- BLOQUEIO DE LOGIN (por ultimo: trava o IP de teste por 5 min) ----
    // 38) 3 senhas erradas -> 429 com o tempo restante para o cronometro
    const bf = criarCliente();
    const respostas = [];
    for (let i = 0; i < 3; i++) {
      respostas.push(await bf('POST', '/api/auth/login', { usuario: 'colodel', senha: 'errada' }));
    }
    const ultima = respostas[respostas.length - 1];
    ok('3 tentativas erradas bloqueiam o login -> 429',
      respostas[0].status === 401 && respostas[1].status === 401 && ultima.status === 429);
    ok('resposta do bloqueio traz os segundos restantes para o cronometro',
      ultima.dados.segundos_restantes > 0 && ultima.dados.segundos_restantes <= 300
      && !!ultima.dados.bloqueado_ate);

    // 39) durante o bloqueio, nem a senha certa entra
    r = await bf('POST', '/api/auth/login', { usuario: 'colodel', senha: SENHA });
    ok('senha correta durante o bloqueio ainda -> 429', r.status === 429);

    // 40) o bloqueio tambem virou registro na trilha de auditoria
    r = await admin('GET', '/api/historico?tipo=login_bloqueio');
    ok('bloqueio registrado no historico', r.status === 200 && r.dados.historico.length > 0);

    console.log(`\n✅ ${passou} verificacoes passaram.\n`);
    servidor.close();
    process.exit(0);
  } catch (e) {
    console.error('\n❌ ' + e.message + '\n');
    servidor.close();
    process.exit(1);
  }
})();
