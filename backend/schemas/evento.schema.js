'use strict';

const { z } = require('zod');
const v = require('../utils/validar');

// 'HH:MM' de 00:00 a 23:59; qualquer outra coisa vira null (dia todo)
const zHora = z.any().optional().transform((x) => {
  const s = String(x ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
});

const campos = {
  titulo: z.any().optional().transform((x) => v.texto(x, 200)).refine((s) => s.length > 0, 'Título é obrigatório'),
  descricao: z.any().optional().transform((x) => v.texto(x, 3000)),
  data: z.any().optional().transform((x) => v.dataOuNull(x)).refine((d) => d !== null, 'Data é obrigatória'),
  hora_inicio: zHora,
  hora_fim: zHora,
  local: z.any().optional().transform((x) => v.texto(x, 200)),
  setor_id: z.any().optional().transform((x) => v.inteiroOuNull(x)), // null = equipe toda
  participantes: z.any().optional().transform((x) => v.listaDeInteiros(x)),
};

// fim antes do inicio no mesmo dia nao existe
const horasCoerentes = (d) => !(d.hora_inicio && d.hora_fim && d.hora_fim < d.hora_inicio);
const MSG_HORAS = 'O horário de término é antes do início';

const criarEventoSchema = z.object(campos).refine(horasCoerentes, MSG_HORAS);
const atualizarEventoSchema = z.object(campos).partial().refine(horasCoerentes, MSG_HORAS);

const filtroEventosSchema = z.object({
  de: z.any().optional().transform((x) => v.dataOuNull(x)),
  ate: z.any().optional().transform((x) => v.dataOuNull(x)),
}).partial();

module.exports = { criarEventoSchema, atualizarEventoSchema, filtroEventosSchema };
