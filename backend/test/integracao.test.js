'use strict';

/**
 * Teste de integracao (memoria). Sobe a API de verdade numa porta de teste
 * e exercita o fluxo principal + as protecoes de seguranca:
 * cabecalhos, method override, bloqueio de login, auditoria, permissoes.
 *
 *   npm test        (com DATABASE_URL vazio -> roda em memoria)
 */

const assert = require('assert');
// o cofre precisa de chave; nos testes, uma aleatoria por execucao
process.env.COFRE_CHAVE = process.env.COFRE_CHAVE || require('crypto').randomBytes(32).toString('base64');
// push sempre desligado nos testes (mesmo com chaves no .env): nada sai para
// servicos de push de verdade. Vazio aqui vale: o dotenv nao sobrescreve.
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
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

    // =================================================================
    //  v0.4: historico com filtros rapidos, calendario interno, equipe,
    //  chat, prompts, mensagens salvas, briefing, cofre, push, recorrentes
    // =================================================================
    const sessaoMembro = criarCliente();
    await sessaoMembro('POST', '/api/auth/login', { usuario: 'morning', senha: SENHA });
    const adm = criarCliente();
    await adm('POST', '/api/auth/login', { usuario: 'admin', senha: SENHA });
    // terceira pessoa, de outro setor (Comercial)
    r = await adm('POST', '/api/usuarios', { nome: 'Pessoa Comercial', usuario: 'comercialteste', senha: 'senha123', setor_id: 2, papel: 'membro' });
    const idComercial = r.dados.usuario.id;
    const comercial = criarCliente();
    await comercial('POST', '/api/auth/login', { usuario: 'comercialteste', senha: 'senha123' });
    const idMorning = (await sessaoMembro('GET', '/api/auth/me')).dados.usuario.id;
    const idAdmin = (await adm('GET', '/api/auth/me')).dados.usuario.id;
    const admO = comOverride(adm);
    const membroO = comOverride(sessaoMembro);
    const comercialO = comOverride(comercial);

    // multipart com a sessao do cliente (o mini cliente so manda JSON)
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    async function enviarArquivo(cli, url, campo, conteudo, tipo, nome, extras = {}) {
      const fd = new FormData();
      Object.entries(extras).forEach(([k, val]) => fd.append(k, val));
      fd.append(campo, new Blob([conteudo], { type: tipo }), nome);
      const resp = await fetch(BASE + url, { method: 'POST', headers: { Cookie: cli.cookie }, body: fd });
      let dados = null; try { dados = await resp.json(); } catch (_) {}
      return { status: resp.status, dados, headers: resp.headers };
    }

    // ---- HISTORICO: filtros rapidos, prioridade, cliente, responsavel ----
    const clientes = (await adm('GET', '/api/clientes')).dados.clientes;
    r = await adm('POST', '/api/tarefas', {
      setor_id: 3, titulo: 'Tarefa alta para filtro', prioridade: 'alta',
      cliente_id: clientes[0] ? clientes[0].id : null, responsaveis: [idMorning],
    });
    const idTarefaAlta = r.dados.tarefa.id;
    r = await adm('GET', '/api/historico?prioridade=alta');
    ok('historico filtra por prioridade (gravada no evento da tarefa)',
      r.status === 200 && r.dados.historico.length > 0 && r.dados.historico.every((h) => h.prioridade === 'alta'));
    r = await adm('GET', '/api/historico?categoria=acessos');
    ok('filtro rapido "acessos" traz so login, falha, bloqueio e logout',
      r.dados.historico.length > 0
      && r.dados.historico.every((h) => ['login', 'login_falha', 'login_bloqueio', 'logout'].includes(h.tipo)));
    r = await adm('GET', '/api/historico?categoria=falhas');
    ok('filtro rapido "falhas" traz so senha errada',
      r.dados.historico.length > 0 && r.dados.historico.every((h) => h.tipo === 'login_falha'));
    r = await adm('GET', '/api/historico?categoria=tarefas&entidade=cliente');
    ok('categoria e tipo conflitantes nao trazem nada', r.status === 200 && r.dados.historico.length === 0);
    r = await adm('GET', '/api/historico?responsavel=Morning');
    ok('historico filtra por responsavel',
      r.dados.historico.length > 0 && r.dados.historico.every((h) => (h.responsaveis || []).some((x) => x.nome === 'Morning')));
    if (clientes[0]) {
      r = await adm('GET', `/api/historico?cliente=${encodeURIComponent(clientes[0].empresa)}`);
      ok('historico filtra por cliente',
        r.dados.historico.length > 0 && r.dados.historico.every((h) => h.cliente_nome === clientes[0].empresa));
    }
    r = await adm('GET', '/api/historico/opcoes');
    ok('opcoes do historico trazem responsaveis e prioridades',
      r.dados.responsaveis.includes('Morning') && r.dados.prioridades.includes('alta'));

    // ---- EQUIPE E FOTO DE PERFIL ----
    r = await sessaoMembro('GET', '/api/equipe');
    ok('equipe visivel para membro, sem login nem papel',
      r.status === 200 && r.dados.equipe.some((u) => u.id === idAdmin)
      && r.dados.equipe.every((u) => !('usuario' in u) && !('papel' in u) && !('senha_hash' in u)));
    r = await enviarArquivo(sessaoMembro, '/api/equipe/eu/avatar', 'foto', PNG, 'image/png', 'eu.png');
    ok('foto de perfil aceita PNG de verdade', r.status === 200 && !!r.dados.avatar_path);
    const fotoResp = await fetch(`${BASE}/api/equipe/${idMorning}/avatar`, { headers: { Cookie: comercial.cookie } });
    ok('colega ve a foto de perfil', fotoResp.status === 200 && /image\/png/.test(fotoResp.headers.get('content-type') || ''));
    r = await enviarArquivo(sessaoMembro, '/api/equipe/eu/avatar', 'foto', Buffer.from('<script>alert(1)</script>'), 'image/png', 'x.png');
    ok('foto com conteudo falso (nao e PNG) -> 400', r.status === 400);
    r = await enviarArquivo(sessaoMembro, '/api/equipe/eu/avatar', 'foto', Buffer.from('%PDF-1.4'), 'application/pdf', 'x.pdf');
    ok('foto de perfil nao aceita PDF -> 400', r.status === 400);
    r = await sessaoMembro('GET', '/api/auth/me');
    ok('/me traz a foto da pessoa', !!r.dados.usuario.avatar_path);

    // ---- CALENDARIO DA EQUIPE ----
    r = await sessaoMembro('POST', '/api/eventos', {
      titulo: 'Reunião de pauta', data: '2026-11-10', hora_inicio: '14:00', hora_fim: '15:00',
      participantes: [idAdmin, 999999],
    });
    const idEventoMembro = r.dados && r.dados.evento && r.dados.evento.id;
    ok('membro cria evento da equipe toda (participante inexistente e ignorado)',
      r.status === 201 && r.dados.evento.participantes.length === 1 && r.dados.evento.participantes[0].id === idAdmin);
    r = await sessaoMembro('POST', '/api/eventos', { titulo: 'X', data: '2026-11-10', setor_id: 2 });
    ok('membro nao cria evento de outro setor -> 403', r.status === 403);
    r = await sessaoMembro('POST', '/api/eventos', { titulo: 'X', data: '2026-11-10', hora_inicio: '15:00', hora_fim: '14:00' });
    ok('termino antes do inicio -> 400', r.status === 400);
    r = await sessaoMembro('POST', '/api/eventos', { titulo: 'X', data: '10/11/2026' });
    ok('data em formato errado -> 400', r.status === 400);
    r = await adm('POST', '/api/eventos', { titulo: 'Visita comercial', data: '2026-11-12', setor_id: 2 });
    const idEventoComercial = r.dados.evento.id;
    r = await sessaoMembro('GET', '/api/eventos?de=2026-11-01&ate=2026-11-30');
    ok('membro ve o evento geral e nao ve o de outro setor',
      r.dados.eventos.some((e) => e.id === idEventoMembro) && !r.dados.eventos.some((e) => e.id === idEventoComercial));
    r = await comercial('GET', '/api/eventos?de=2026-11-01&ate=2026-11-30');
    ok('pessoa do setor ve o evento do proprio setor', r.dados.eventos.some((e) => e.id === idEventoComercial));
    r = await sessaoMembro('GET', `/api/eventos/${idEventoComercial}`);
    ok('evento de outro setor nem aparece por id -> 404', r.status === 404);
    r = await comercialO('PUT', `/api/eventos/${idEventoMembro}`, { titulo: 'Mudei' });
    ok('so quem criou (ou admin) edita o evento -> 403', r.status === 403);
    r = await admO('PUT', `/api/eventos/${idEventoMembro}`, { hora_fim: '13:00' });
    ok('edicao parcial que deixa o fim antes do inicio -> 400', r.status === 400);
    r = await membroO('PUT', `/api/eventos/${idEventoMembro}`, { local: 'Sala 2', participantes: [idAdmin, idComercial] });
    ok('quem criou edita local e participantes', r.status === 200 && r.dados.evento.local === 'Sala 2'
      && r.dados.evento.participantes.length === 2);
    r = await comercial('GET', `/api/eventos/${idEventoMembro}`);
    ok('participante passa a ver o evento', r.status === 200);
    r = await adm('GET', '/api/historico?entidade=evento');
    ok('eventos entram na trilha de auditoria', r.dados.historico.some((h) => h.tipo === 'criada'));
    r = await membroO('DELETE', `/api/eventos/${idEventoMembro}`);
    ok('quem criou exclui o evento', r.status === 200);

    // ---- CHAT ----
    r = await sessaoMembro('POST', '/api/chat/conversas', { tipo: 'direta', usuario_id: idComercial });
    const idDireta = r.dados.conversa.id;
    ok('abre conversa direta', r.status === 201 && r.dados.conversa.membros.length === 2);
    r = await comercial('POST', '/api/chat/conversas', { tipo: 'direta', usuario_id: idMorning });
    ok('conversa direta e unica por par (reaproveita a existente)', r.status === 200 && r.dados.conversa.id === idDireta);
    r = await sessaoMembro('POST', '/api/chat/conversas', { tipo: 'direta', usuario_id: idMorning });
    ok('nao abre conversa consigo mesmo -> 400', r.status === 400);
    r = await sessaoMembro('POST', `/api/chat/conversas/${idDireta}/mensagens`, { texto: 'Oi, tudo bem?' });
    ok('envia mensagem', r.status === 201 && r.dados.mensagem.texto === 'Oi, tudo bem?');
    r = await sessaoMembro('POST', `/api/chat/conversas/${idDireta}/mensagens`, { texto: '   ' });
    ok('mensagem vazia -> 400', r.status === 400);
    r = await comercial('GET', '/api/chat/resumo');
    ok('destinatario ve 1 nao lida', r.dados.nao_lidas === 1);
    r = await sessaoMembro('GET', '/api/chat/resumo');
    ok('quem escreveu nao conta a propria mensagem como nao lida', r.dados.nao_lidas === 0);
    r = await adm('GET', `/api/chat/conversas/${idDireta}/mensagens`);
    ok('admin nao le conversa de que nao participa -> 404', r.status === 404);
    r = await comercial('GET', `/api/chat/conversas/${idDireta}/mensagens`);
    const msgs = r.dados.mensagens;
    ok('membro le as mensagens em ordem', r.status === 200 && msgs.length === 1 && msgs[0].usuario_nome === 'Morning');
    await comercial('POST', `/api/chat/conversas/${idDireta}/lida`, { ate_id: msgs[0].id });
    r = await comercial('GET', '/api/chat/resumo');
    ok('marcar como lida zera o contador', r.dados.nao_lidas === 0);
    r = await enviarArquivo(sessaoMembro, `/api/chat/conversas/${idDireta}/mensagens`, 'arquivo', PNG, 'image/png', 'print.png', { texto: 'segue o print' });
    ok('envia imagem no chat', r.status === 201 && r.dados.mensagem.anexo_nome_original === 'print.png');
    const idMsgAnexo = r.dados.mensagem.id;
    let resp = await fetch(`${BASE}/api/chat/anexos/${idMsgAnexo}`, { headers: { Cookie: comercial.cookie } });
    ok('membro abre o anexo do chat', resp.status === 200 && /inline/.test(resp.headers.get('content-disposition') || ''));
    resp = await fetch(`${BASE}/api/chat/anexos/${idMsgAnexo}`, { headers: { Cookie: adm.cookie } });
    ok('quem nao e membro nao baixa o anexo -> 404', resp.status === 404);
    r = await enviarArquivo(adm, `/api/chat/conversas/${idDireta}/mensagens`, 'arquivo', PNG, 'image/png', 'intruso.png');
    ok('quem nao e membro nao envia arquivo -> 404', r.status === 404);

    r = await adm('POST', '/api/chat/conversas', { tipo: 'grupo', nome: 'Pauta da semana', membros: [idMorning, 999999] });
    const idGrupo = r.dados.conversa.id;
    ok('cria grupo (ignora quem nao existe; criador entra sozinho)',
      r.status === 201 && r.dados.conversa.membros.length === 2);
    r = await adm('POST', '/api/chat/conversas', { tipo: 'grupo', nome: '' });
    ok('grupo sem nome -> 400', r.status === 400);
    r = await membroO('PUT', `/api/chat/conversas/${idGrupo}`, { nome: 'Renomeado' });
    ok('so quem criou o grupo (ou admin) renomeia -> 403', r.status === 403);
    r = await sessaoMembro('GET', '/api/chat/conversas');
    ok('lista de conversas traz o grupo e a direta', r.dados.conversas.some((c) => c.id === idGrupo)
      && r.dados.conversas.some((c) => c.id === idDireta));
    r = await sessaoMembro('POST', `/api/chat/conversas/${idGrupo}/sair`);
    ok('membro sai do grupo', r.status === 200);
    r = await sessaoMembro('GET', `/api/chat/conversas/${idGrupo}/mensagens`);
    ok('depois de sair, nao le mais o grupo -> 404', r.status === 404);
    r = await admO('DELETE', `/api/chat/conversas/${idGrupo}`);
    ok('criador apaga o grupo', r.status === 200);

    // ---- PROMPTS (equipe) E MENSAGENS SALVAS (pessoais) ----
    r = await sessaoMembro('POST', '/api/prompts', { titulo: 'Legenda de carrossel', conteudo: 'Escreva uma legenda...' });
    const idPrompt = r.dados.item.id;
    ok('membro cria prompt', r.status === 201);
    r = await comercial('GET', '/api/prompts');
    ok('prompt aparece para a equipe toda', r.dados.itens.some((p) => p.id === idPrompt && p.autor_nome === 'Morning'));
    r = await comercialO('PUT', `/api/prompts/${idPrompt}`, { titulo: 'Mexi', conteudo: '' });
    ok('outro membro nao edita prompt alheio -> 403', r.status === 403);
    r = await admO('PUT', `/api/prompts/${idPrompt}`, { titulo: 'Legenda (revisado)', conteudo: 'ok' });
    ok('admin edita qualquer prompt', r.status === 200 && r.dados.item.titulo === 'Legenda (revisado)');
    r = await sessaoMembro('POST', '/api/mensagens-salvas', { titulo: 'Resposta de orçamento', conteudo: 'Olá! Segue...' });
    const idMsgSalva = r.dados.item.id;
    r = await comercial('GET', '/api/mensagens-salvas');
    ok('mensagem salva e pessoal: o colega nao ve', !r.dados.itens.some((m) => m.id === idMsgSalva));
    r = await adm('GET', '/api/mensagens-salvas');
    ok('nem o admin ve a mensagem salva de outra pessoa', !r.dados.itens.some((m) => m.id === idMsgSalva));
    r = await comercialO('DELETE', `/api/mensagens-salvas/${idMsgSalva}`);
    ok('colega nao apaga mensagem salva alheia -> 404', r.status === 404);
    r = await sessaoMembro('GET', '/api/mensagens-salvas');
    ok('o dono ve a propria mensagem salva', r.dados.itens.some((m) => m.id === idMsgSalva));

    // ---- BRIEFING ----
    r = await sessaoMembro('GET', '/api/briefings/campos');
    ok('perguntas do briefing vem do servidor', r.status === 200 && r.dados.campos.length > 0);
    r = await sessaoMembro('POST', '/api/briefings', {
      empresa: 'Padaria Exemplo', respostas: { nome_fantasia: 'Padaria Exemplo', cores: 'Amarelo', chave_inventada: 'x' },
    });
    const idBriefing = r.dados.briefing.id;
    ok('briefing guarda so as perguntas conhecidas',
      r.status === 201 && r.dados.briefing.respostas.cores === 'Amarelo' && !('chave_inventada' in r.dados.briefing.respostas));
    r = await comercial('GET', '/api/briefings');
    ok('lista de briefings mostra o progresso', r.dados.briefings.some((b) => b.id === idBriefing && b.preenchidos === 2));
    r = await comercialO('DELETE', `/api/briefings/${idBriefing}`);
    ok('so quem criou (ou admin) exclui briefing -> 403', r.status === 403);
    r = await sessaoMembro('POST', '/api/briefings', { empresa: 'X', cliente_id: 999999 });
    ok('briefing com cliente inexistente -> 400', r.status === 400);

    r = await enviarArquivo(sessaoMembro, `/api/briefings/${idBriefing}/arquivos`, 'arquivo', PNG, 'image/png', 'logo.png');
    ok('briefing aceita arquivo', r.status === 201 && r.dados.arquivo.nome_original === 'logo.png');
    const idArqBriefing = r.dados.arquivo.id;
    r = await enviarArquivo(sessaoMembro, `/api/briefings/${idBriefing}/arquivos`, 'arquivo', Buffer.from('MZ executavel'), 'image/png', 'virus.png');
    ok('arquivo do briefing com conteudo falso -> 400', r.status === 400);
    r = await comercial('GET', `/api/briefings/${idBriefing}/arquivos`);
    ok('equipe ve os arquivos do briefing', r.dados.arquivos.length === 1 && r.dados.arquivos[0].enviado_por_nome === 'Morning');
    resp = await fetch(`${BASE}/api/briefings/arquivos/${idArqBriefing}`, { headers: { Cookie: comercial.cookie } });
    ok('arquivo do briefing abre', resp.status === 200 && /image\/png/.test(resp.headers.get('content-type') || ''));
    r = await comercialO('DELETE', `/api/briefings/arquivos/${idArqBriefing}`);
    ok('quem nao enviou nem criou nao apaga arquivo do briefing -> 403', r.status === 403);
    r = await membroO('DELETE', `/api/briefings/${idBriefing}`);
    ok('quem criou exclui o briefing (com os arquivos)', r.status === 200);
    r = await sessaoMembro('GET', `/api/briefings/${idBriefing}/arquivos`);
    ok('arquivos somem junto com o briefing', r.status === 404);

    // ---- SERVICOS E DATAS DO CLIENTE ----
    const idCli = clientes[0].id;
    r = await adm('POST', `/api/clientes/${idCli}/servicos`, { nome: 'SEO' });
    const idServ = r.dados.servico && r.dados.servico.id;
    ok('adiciona servico ao cliente', r.status === 201 && r.dados.servico.nome === 'SEO');
    r = await adm('POST', `/api/clientes/${idCli}/servicos`, { nome: 'seo' });
    ok('servico repetido (sem diferenciar maiuscula) -> 409', r.status === 409);
    r = await sessaoMembro('POST', `/api/clientes/${idCli}/servicos`, { nome: 'Branding' });
    ok('sem permissao de clientes nao adiciona servico -> 403', r.status === 403);
    r = await adm('POST', `/api/clientes/${idCli}/datas`, { data: '2026-13-01', nome: 'X' });
    ok('mes 13 -> 400', r.status === 400);
    r = await adm('POST', `/api/clientes/${idCli}/datas`, { data: '2026-04-31', nome: 'X' });
    ok('31/04 -> 400', r.status === 400);
    r = await adm('POST', `/api/clientes/${idCli}/datas`, { data: '2026-08-15', nome: 'Aniversário da empresa' });
    const idDataCli = r.dados.data.id;
    ok('adiciona data importante (dia e mes)', r.status === 201 && r.dados.data.mes === 8 && r.dados.data.dia === 15);
    r = await sessaoMembro('GET', `/api/clientes/${idCli}`);
    ok('ficha do cliente traz servicos e datas', r.dados.cliente.servicos.some((s) => s.id === idServ)
      && r.dados.cliente.datas.some((d) => d.id === idDataCli));
    r = await sessaoMembro('GET', '/api/clientes/datas');
    ok('lista geral de datas traz o nome do cliente', r.status === 200
      && r.dados.datas.some((d) => d.id === idDataCli && d.cliente_nome === clientes[0].empresa));
    r = await admO('DELETE', `/api/clientes/${idCli}/servicos/${idServ}`);
    ok('remove servico', r.status === 200);
    r = await admO('DELETE', `/api/clientes/${idCli}/datas/${idDataCli}`);
    ok('remove data', r.status === 200);
    r = await admO('DELETE', `/api/clientes/${idCli}/datas/${idDataCli}`);
    ok('remover de novo -> 404', r.status === 404);

    // ---- PREVIA DE ANEXO DENTRO DO SISTEMA ----
    r = await adm('POST', '/api/tarefas', { setor_id: 3, titulo: 'Tarefa com PDF' });
    const idTarefaPdf = r.dados.tarefa.id;
    r = await enviarArquivo(adm, `/api/tarefas/${idTarefaPdf}/anexos`, 'arquivo', Buffer.from('%PDF-1.4\n%fim'), 'application/pdf', 'proposta.pdf');
    const idAnexoPdf = r.dados && r.dados.anexo && r.dados.anexo.id;
    resp = await fetch(`${BASE}/api/anexos/${idAnexoPdf}/preview`, { headers: { Cookie: adm.cookie } });
    const cspPrevia = resp.headers.get('content-security-policy') || '';
    ok('previa de PDF pode abrir no iframe do proprio sistema (e so dele)',
      resp.status === 200 && resp.headers.get('x-frame-options') === 'SAMEORIGIN'
      && /frame-ancestors 'self'/.test(cspPrevia) && !/sandbox/.test(cspPrevia));
    resp = await fetch(`${BASE}/api/anexos/${idAnexoPdf}`, { headers: { Cookie: adm.cookie } });
    ok('o resto da API continua sem poder ir para iframe', resp.headers.get('x-frame-options') === 'DENY');
    await admO('DELETE', `/api/tarefas/${idTarefaPdf}`);

    // ---- COFRE DE ACESSOS ----
    r = await sessaoMembro('GET', '/api/acessos');
    ok('membro nao entra no cofre -> 403', r.status === 403);
    r = await adm('POST', '/api/acessos', {
      servico: 'Hospedagem', login: 'cliente@exemplo.com', senha: 'S3nha-Super-Secreta', url: 'javascript:alert(1)',
    });
    const idAcesso = r.dados.acesso.id;
    ok('admin guarda acesso; a resposta nao traz a senha',
      r.status === 201 && r.dados.acesso.tem_senha === true
      && !JSON.stringify(r.dados).includes('S3nha-Super-Secreta') && !('senha_cifrada' in r.dados.acesso));
    ok('url perigosa (javascript:) e descartada', r.dados.acesso.url === '');
    r = await adm('GET', '/api/acessos');
    ok('listagem do cofre nunca traz senha', r.status === 200 && !JSON.stringify(r.dados).includes('S3nha-Super-Secreta')
      && !JSON.stringify(r.dados).includes('senha_cifrada'));
    r = await adm('POST', `/api/acessos/${idAcesso}/revelar`);
    ok('revelar devolve a senha decifrada', r.status === 200 && r.dados.senha === 'S3nha-Super-Secreta');
    r = await adm('GET', '/api/historico?categoria=cofre');
    ok('senha revelada fica registrada na trilha', r.dados.historico.some((h) => h.tipo === 'senha_vista' && h.entidade_id === idAcesso));
    r = await admO('PUT', `/api/acessos/${idAcesso}`, { senha: '' });
    ok('senha vazia apaga a senha guardada', r.status === 200 && r.dados.acesso.tem_senha === false);
    r = await admO('DELETE', `/api/acessos/${idAcesso}`);
    ok('admin exclui acesso do cofre', r.status === 200);

    // ---- PUSH ----
    r = await sessaoMembro('GET', '/api/push/vapid');
    ok('sem chaves VAPID o push fica desligado (chave null)', r.status === 200 && r.dados.chave === null);
    r = await sessaoMembro('POST', '/api/push/inscrever', {
      subscription: { endpoint: 'https://127.0.0.1/interno', keys: { p256dh: 'abc', auth: 'def' } },
    });
    ok('inscricao com endereco que nao e servico de push -> 400 (sem SSRF)', r.status === 400);
    r = await sessaoMembro('POST', '/api/push/inscrever', {
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'abc', auth: 'def' } },
    });
    ok('inscricao valida com push desligado -> 503', r.status === 503);

    // ---- RECORRENTES ----
    r = await adm('POST', '/api/tarefas', { setor_id: 3, titulo: 'Relatório semanal', recorrencia: 'semanal', data_entrega: '2026-11-06' });
    const idRecorrente = r.dados.tarefa.id;
    r = await sessaoMembro('GET', '/api/tarefas/recorrentes');
    ok('membro ve as series recorrentes do proprio setor', r.status === 200 && r.dados.tarefas.some((t) => t.id === idRecorrente));
    r = await comercial('GET', '/api/tarefas/recorrentes');
    ok('outro setor nao ve a serie', !r.dados.tarefas.some((t) => t.id === idRecorrente));
    r = await comercial('GET', '/api/tarefas/recorrentes?setor=3');
    ok('pedir setor alheio -> 403', r.status === 403);
    await admO('DELETE', `/api/tarefas/${idRecorrente}`);
    await admO('DELETE', `/api/tarefas/${idTarefaAlta}`);

    // =================================================================
    //  correcoes da auditoria de seguranca
    // =================================================================
    const fs = require('fs');
    const path = require('path');
    const config = require('../config');
    const pastaUploads = path.join(__dirname, '..', 'uploads');
    const contarArquivos = () => fs.readdirSync(pastaUploads).length;

    // 1) a rota generica de logo nao serve mais arquivo nenhum
    r = await adm('POST', '/api/chat/conversas', { tipo: 'grupo', nome: 'Auditoria', membros: [idComercial] });
    const idGrupoAud = r.dados.conversa.id;
    r = await enviarArquivo(adm, `/api/chat/conversas/${idGrupoAud}/mensagens`, 'arquivo', PNG, 'image/png', 'segredo.png');
    const arqChat = r.dados.mensagem.anexo_arquivo;
    resp = await fetch(`${BASE}/api/clientes/logo/${arqChat}`, { headers: { Cookie: sessaoMembro.cookie } });
    ok('quem nao e do grupo nao baixa o anexo por outra rota (logo/:arquivo sumiu)', resp.status === 404 || resp.status === 400);

    // 2) extensao em disco vem do tipo aceito, nunca do nome enviado
    r = await enviarArquivo(sessaoMembro, '/api/equipe/eu/avatar', 'foto', PNG, 'image/png', 'pagina.html');
    ok('foto enviada como "pagina.html" fica gravada como .png', r.status === 200 && /\.png$/.test(r.dados.avatar_path));
    resp = await fetch(`${BASE}/api/equipe/${idMorning}/avatar`, { headers: { Cookie: comercial.cookie } });
    ok('e e servida como imagem, nunca como HTML', /image\/png/.test(resp.headers.get('content-type') || ''));

    // 3) sem permissao na tarefa, o anexo nem chega ao disco
    r = await adm('POST', '/api/tarefas', { setor_id: 2, titulo: 'Tarefa do Comercial' });
    const idTarefaComercial = r.dados.tarefa.id;
    let antes = contarArquivos();
    r = await enviarArquivo(sessaoMembro, `/api/tarefas/${idTarefaComercial}/anexos`, 'arquivo', PNG, 'image/png', 'x.png');
    ok('anexo em tarefa de outro setor -> 403 e nenhum arquivo fica no disco', r.status === 403 && contarArquivos() === antes);

    // 4) falhas de login simultaneas contam todas
    await Promise.all(Array.from({ length: 6 }, () => bloqueioLogin.registrarFalha('198.51.100.7', 'alguem')));
    ok('6 senhas erradas ao mesmo tempo bloqueiam a origem', (await bloqueioLogin.estado('198.51.100.7', 'alguem')).bloqueado === true);
    await bloqueioLogin.limpar('198.51.100.7', 'alguem');

    // 5) cota de upload por pessoa (quantidade por hora e bytes por dia)
    const cotaOriginal = { qtd: config.uploadMaxPorHora, bytes: config.uploadCotaDiariaBytes };
    r = await adm('POST', '/api/usuarios', { nome: 'Cota', usuario: 'cotateste', senha: 'senha123', setor_id: 2, papel: 'membro' });
    const cota = criarCliente();
    await cota('POST', '/api/auth/login', { usuario: 'cotateste', senha: 'senha123' });
    config.uploadCotaDiariaBytes = PNG.length + 4; // cabe 1 arquivo de teste por dia
    r = await enviarArquivo(cota, '/api/equipe/eu/avatar', 'foto', PNG, 'image/png', 'a.png');
    ok('primeiro arquivo dentro da cota entra', r.status === 200);
    antes = contarArquivos();
    r = await enviarArquivo(cota, '/api/equipe/eu/avatar', 'foto', PNG, 'image/png', 'b.png');
    ok('arquivo que passa da cota diaria -> 429 e e apagado do disco', r.status === 429 && contarArquivos() === antes);
    r = await enviarArquivo(cota, '/api/equipe/eu/avatar', 'foto', PNG, 'image/png', 'c.png');
    ok('com a cota cheia, nem chega a gravar -> 429', r.status === 429 && contarArquivos() === antes);
    config.uploadCotaDiariaBytes = cotaOriginal.bytes;
    config.uploadMaxPorHora = 4; // o usuario ja gastou 3 nesta hora
    r = await enviarArquivo(cota, '/api/equipe/eu/avatar', 'foto', PNG, 'image/png', 'd.png');
    const quarto = r.status;
    r = await enviarArquivo(cota, '/api/equipe/eu/avatar', 'foto', PNG, 'image/png', 'e.png');
    ok('passou do limite de arquivos por hora -> 429', quarto === 200 && r.status === 429);
    config.uploadMaxPorHora = cotaOriginal.qtd;
    r = await cota('POST', '/api/chat/conversas', { tipo: 'direta', usuario_id: idComercial });
    r = await cota('POST', `/api/chat/conversas/${r.dados.conversa.id}/mensagens`, { texto: 'so texto' });
    ok('com a cota de upload esgotada, mensagem so de texto continua indo', r.status === 201);

    // 6) teto de conexoes de aviso em tempo real por pessoa
    const abertas = [];
    for (let i = 0; i < 6; i++) {
      const ctl = new AbortController();
      const rs = await fetch(`${BASE}/api/notificacoes/stream`, { headers: { Cookie: comercial.cookie }, signal: ctl.signal });
      abertas.push({ ctl, status: rs.status });
    }
    const setima = await fetch(`${BASE}/api/notificacoes/stream`, { headers: { Cookie: comercial.cookie } });
    ok('6 conexoes abrem e a 7a e recusada (429)', abertas.every((x) => x.status === 200) && setima.status === 429);
    abertas.forEach((x) => x.ctl.abort());
    await new Promise((ok2) => setTimeout(ok2, 150)); // o servidor percebe o fechamento
    const ctl8 = new AbortController();
    const depois = await fetch(`${BASE}/api/notificacoes/stream`, { headers: { Cookie: comercial.cookie }, signal: ctl8.signal });
    ok('fechou as abas, volta a conectar', depois.status === 200);
    ctl8.abort();

    // 7) concluir a mesma recorrente duas vezes ao mesmo tempo gera so uma proxima
    r = await adm('POST', '/api/tarefas', { setor_id: 3, titulo: 'Pauta semanal', recorrencia: 'semanal', data_entrega: '2026-11-13' });
    const idSerie = r.dados.tarefa.id;
    const colunasDoCriativo = (await adm('GET', '/api/setores/3/colunas')).dados.colunas;
    const colFim = colunasDoCriativo.find((c) => c.e_conclusao);
    const duplo = await Promise.all([
      admO('PATCH', `/api/tarefas/${idSerie}/mover`, { coluna_id: colFim.id }),
      admO('PATCH', `/api/tarefas/${idSerie}/mover`, { coluna_id: colFim.id }),
    ]);
    const geradas = (await adm('GET', '/api/tarefas?setor=3')).dados.tarefas.filter((t) => t.recorrencia_origem_id === idSerie);
    ok('dois "concluir" simultaneos: uma proxima ocorrencia so', duplo.every((x) => x.status === 200) && geradas.length === 1);
    // a rotina e a conclusao podem chamar a geracao juntas: so uma leva a reserva
    const { gerarProxima } = require('../services/recorrencia');
    r = await adm('POST', '/api/tarefas', { setor_id: 3, titulo: 'Relatório mensal', recorrencia: 'mensal', data_entrega: '2026-11-20' });
    const serie2 = r.dados.tarefa;
    const corrida = await Promise.all([gerarProxima(serie2), gerarProxima(serie2)]);
    ok('duas geracoes simultaneas da mesma serie: so uma cria tarefa', corrida.filter(Boolean).length === 1);
    ok('copia velha da tarefa (sem saber que ja gerou) nao gera de novo', (await gerarProxima(serie2)) === null);

    // 8) conversa direta aberta pelos dois ao mesmo tempo vira uma so
    r = await adm('POST', '/api/usuarios', { nome: 'Par A', usuario: 'para', senha: 'senha123', setor_id: 2, papel: 'membro' });
    const idParA = r.dados.usuario.id;
    const parA = criarCliente();
    await parA('POST', '/api/auth/login', { usuario: 'para', senha: 'senha123' });
    const simult = await Promise.all([
      parA('POST', '/api/chat/conversas', { tipo: 'direta', usuario_id: idComercial }),
      comercial('POST', '/api/chat/conversas', { tipo: 'direta', usuario_id: idParA }),
    ]);
    ok('os dois abrindo ao mesmo tempo caem na mesma conversa',
      simult[0].dados.conversa.id === simult[1].dados.conversa.id);

    // 9) mesmo login criado duas vezes ao mesmo tempo: um entra, o outro 409
    const dupla = await Promise.all([
      adm('POST', '/api/usuarios', { nome: 'Gemeo', usuario: 'gemeo', senha: 'senha123', setor_id: 2, papel: 'membro' }),
      adm('POST', '/api/usuarios', { nome: 'Gemeo', usuario: 'gemeo', senha: 'senha123', setor_id: 2, papel: 'membro' }),
    ]);
    ok('login duplicado simultaneo: 201 e 409, nunca 500',
      dupla.map((x) => x.status).sort().join(',') === '201,409');

    // 11) os limites de frequencia contam no repositorio (sobrevivem a reinicio)
    const repoTeste = require('../data');
    const { StoreNoBanco } = require('../middleware/rateLimit');
    const store = new StoreNoBanco('rl-teste:');
    store.init({ windowMs: 60000 });
    const contagens = await Promise.all([store.increment('x'), store.increment('x'), store.increment('x')]);
    ok('3 pedidos simultaneos somam 3 no repositorio (nao na memoria do processo)',
      contagens.map((c) => c.totalHits).sort().join(',') === '1,2,3'
      && (await repoTeste.lerUso('rl-teste:x')).contador === 3);
    await store.resetKey('x');
    ok('zerar a chave limpa o contador', (await repoTeste.lerUso('rl-teste:x')) === null);
    await admO('DELETE', `/api/tarefas/${idTarefaComercial}`);

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
