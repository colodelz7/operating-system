import { describe, it, expect, vi, beforeEach } from 'vitest';
import { API } from './api';

/* A hospedagem bloqueia PUT/PATCH/DELETE no WAF. O front manda POST com o
   metodo verdadeiro no cabecalho e o backend restaura. Se alguem mexer nisso
   sem querer, edicao, movimentacao e exclusao param de funcionar em producao
   e continuam funcionando no localhost: exatamente o tipo de quebra que
   demora para aparecer. Daí estes testes. */

function respostaFalsa(dados, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => dados };
}

describe('API', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('manda GET direto, sem cabecalho de override', async () => {
    global.fetch.mockResolvedValue(respostaFalsa({ tarefas: [] }));
    await API.get('/api/tarefas');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/tarefas');
    expect(opts.method).toBe('GET');
    expect(opts.headers['X-HTTP-Method-Override']).toBeUndefined();
  });

  it.each([['PUT', 'put'], ['PATCH', 'patch'], ['DELETE', 'del']])(
    'envia %s como POST com o metodo no cabecalho',
    async (metodo, funcao) => {
      global.fetch.mockResolvedValue(respostaFalsa({ ok: true }));
      await API[funcao]('/api/tarefas/1', { titulo: 'x' });
      const [, opts] = global.fetch.mock.calls[0];
      expect(opts.method).toBe('POST');
      expect(opts.headers['X-HTTP-Method-Override']).toBe(metodo);
    },
  );

  it('leva a mensagem de erro da API e o status para quem chamou', async () => {
    global.fetch.mockResolvedValue(respostaFalsa({ erro: 'Sem acesso' }, { ok: false, status: 403 }));
    await expect(API.get('/api/tarefas')).rejects.toMatchObject({
      message: 'Sem acesso',
      status: 403,
    });
  });

  it('entrega os dados do erro (o cronometro do bloqueio depende disso)', async () => {
    global.fetch.mockResolvedValue(
      respostaFalsa({ erro: 'Muitas tentativas', segundos_restantes: 300 }, { ok: false, status: 429 }),
    );
    await expect(API.post('/api/auth/login', {})).rejects.toMatchObject({
      status: 429,
      dados: { segundos_restantes: 300 },
    });
  });

  it('tenta o GET de novo quando o proxy responde 502 (restart curto)', async () => {
    global.fetch
      .mockResolvedValueOnce(respostaFalsa(null, { ok: false, status: 502 }))
      .mockResolvedValueOnce(respostaFalsa({ tarefas: [1] }));
    const r = await API.get('/api/tarefas');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ tarefas: [1] });
  });

  it('nao repete escrita: POST que falha nao e reenviado', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(null, { ok: false, status: 502 }));
    await expect(API.post('/api/tarefas', { titulo: 'x' })).rejects.toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
