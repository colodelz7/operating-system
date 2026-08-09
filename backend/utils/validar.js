'use strict';

// Helpers simples de validacao/normalizacao usados nas rotas.

function texto(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function dataOuNull(v) {
  if (!v) return null;
  // aceita 'YYYY-MM-DD'
  const m = /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
  return m ? String(v).trim() : null;
}

function inteiroOuNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function listaDeInteiros(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
}

const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'];
function prioridade(v) {
  return PRIORIDADES.includes(v) ? v : 'normal';
}

module.exports = { texto, dataOuNull, inteiroOuNull, listaDeInteiros, prioridade, PRIORIDADES };
