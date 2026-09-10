import { describe, it, expect } from 'vitest';
import { validarUrlCalendario, DOMINIOS_CALENDARIO } from './calendario';

/* O endereco do calendario vem digitado por quem usa e vai parar no src de um
   iframe. Estes testes travam a regra: so https, so dominio conhecido. */

describe('validarUrlCalendario', () => {
  it('aceita o endereco de incorporar do Google Calendar', () => {
    const url = 'https://calendar.google.com/calendar/embed?src=equipe%40empresa.com';
    expect(validarUrlCalendario(url)).toBe(url);
  });

  it('aceita subdominio de um servico conhecido', () => {
    expect(validarUrlCalendario('https://www.calendar.google.com/calendar/embed')).toBeTruthy();
  });

  it.each([
    ['javascript:alert(1)', 'esquema javascript'],
    ['data:text/html,<script>alert(1)</script>', 'esquema data'],
    ['http://calendar.google.com/calendar/embed', 'http sem TLS'],
    ['https://site-qualquer.com/calendario', 'dominio fora da lista'],
    ['https://calendar.google.com.invasor.net/embed', 'dominio parecido, mas outro'],
    ['', 'vazio'],
    ['nem url', 'texto solto'],
  ])('recusa %s (%s)', (entrada) => {
    expect(validarUrlCalendario(entrada)).toBeNull();
  });

  it('mantem a lista de dominios explicita e nao vazia', () => {
    expect(DOMINIOS_CALENDARIO.length).toBeGreaterThan(0);
    expect(DOMINIOS_CALENDARIO).toContain('calendar.google.com');
  });
});
