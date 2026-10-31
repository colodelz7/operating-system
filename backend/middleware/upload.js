'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

const PASTA_UPLOADS = path.join(__dirname, '..', 'uploads');

// Extensao vinda do nome enviado pelo usuario: so letras/numeros, curta.
// Qualquer outra coisa (".", "..", "/", nulos, extensao gigante) e descartada.
function extensaoSegura(nomeOriginal) {
  const ext = path.extname(String(nomeOriginal || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

/**
 * Resolve o caminho de um arquivo DENTRO da pasta de uploads.
 * Devolve null se o nome tentar sair da pasta (../, caminho absoluto,
 * separador de diretorio, byte nulo). Use sempre isto antes de ler do disco.
 */
function caminhoSeguro(nomeArquivo) {
  const nome = String(nomeArquivo || '');
  if (!nome || nome.includes('\0')) return null;
  if (nome !== path.basename(nome)) return null; // barra, ../, absoluto
  const destino = path.resolve(PASTA_UPLOADS, nome);
  const raiz = path.resolve(PASTA_UPLOADS) + path.sep;
  return destino.startsWith(raiz) ? destino : null;
}

// unica fonte da extensao gravada em disco (tipos da allowlist do config)
const EXTENSAO_POR_TIPO = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PASTA_UPLOADS),
  filename: (req, file, cb) => {
    // nome no disco = aleatorio, e a extensao vem do TIPO aceito, nunca do
    // nome enviado: senao um "x.html" com cabecalho de PNG seria servido
    // como pagina HTML dentro do sistema
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXTENSAO_POR_TIPO[file.mimetype] || ''}`);
  },
});

function fileFilter(req, file, cb) {
  if (config.uploadAllowedMime.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Tipo de arquivo não permitido'));
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.uploadMaxBytes }, // 25MB
});

// Foto de perfil: so imagem (nada de PDF/Office) e no maximo 3MB.
const IMAGENS = ['image/png', 'image/jpeg', 'image/webp'];
const uploadImagem = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (IMAGENS.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido'));
  },
  limits: { fileSize: config.avatarMaxBytes, files: 1 },
});

// Apaga um arquivo da pasta de uploads (melhor-esforco: some ou ja sumiu).
function apagarArquivo(nomeArquivo) {
  const destino = caminhoSeguro(nomeArquivo);
  if (destino) fs.unlink(destino, () => {});
}

module.exports = { upload, uploadImagem, apagarArquivo, PASTA_UPLOADS, caminhoSeguro, extensaoSegura };
