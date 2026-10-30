'use strict';

/**
 * Cifra das senhas do cofre de acessos.
 *
 * AES-256-GCM com a chave COFRE_CHAVE (32 bytes em base64), que fica so no
 * .env do servidor. O banco guarda "v1:<iv>:<tag>:<cifrado>"; quem tiver so
 * o banco (um backup vazado, por exemplo) nao le senha nenhuma. O GCM tambem
 * garante integridade: texto adulterado no banco falha ao abrir em vez de
 * devolver lixo.
 */

const crypto = require('crypto');
const config = require('../config');

let chaveCache;
function chave() {
  if (chaveCache !== undefined) return chaveCache;
  const bruta = Buffer.from(config.cofreChave || '', 'base64');
  chaveCache = bruta.length === 32 ? bruta : null;
  return chaveCache;
}

// Cofre so liga com uma chave valida de 32 bytes.
function cofreAtivo() {
  return chave() !== null;
}

function cifrar(texto) {
  const k = chave();
  if (!k) throw new Error('Cofre desligado');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

function decifrar(guardado) {
  const k = chave();
  if (!k) throw new Error('Cofre desligado');
  const [versao, iv, tag, cifrado] = String(guardado || '').split(':');
  if (versao !== 'v1' || !iv || !tag || cifrado === undefined) throw new Error('Formato de senha desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(cifrado, 'base64')), d.final()]).toString('utf8');
}

module.exports = { cofreAtivo, cifrar, decifrar };
