'use strict';

/**
 * Confere o arquivo pelo CONTEUDO, e nao pelo tipo que o navegador declarou.
 *
 * O `fileFilter` do multer so enxerga o cabecalho Content-Type do formulario,
 * que quem envia escolhe. Dava para mandar um HTML com script dizendo que era
 * image/png e o arquivo entrava. Aqui a gente abre os primeiros bytes e
 * compara com a assinatura real do formato. Se nao bater, o arquivo e apagado
 * do disco antes de virar anexo.
 *
 * Observacao sobre docx e xlsx: por dentro sao ZIP, e doc e xls sao OLE2, os
 * dois formatos antigos da Microsoft. Por isso varios tipos compartilham a
 * mesma assinatura.
 */

const fs = require('fs');
const fsp = require('fs/promises');

const ZIP = [0x50, 0x4b, 0x03, 0x04];        // PK.. (docx, xlsx)
const ZIP_VAZIO = [0x50, 0x4b, 0x05, 0x06];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // doc, xls

// Cada tipo aceito e uma lista de assinaturas possiveis.
const ASSINATURAS = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],                        // GIF8
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],            // %PDF-
  'application/msword': [OLE2],
  'application/vnd.ms-excel': [OLE2],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [ZIP, ZIP_VAZIO],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [ZIP, ZIP_VAZIO],
};

const comeca = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

// webp e RIFF....WEBP: o marcador fica no byte 8, depois do tamanho
function ehWebp(buf) {
  return comeca(buf, [0x52, 0x49, 0x46, 0x46])
    && [0x57, 0x45, 0x42, 0x50].every((b, i) => buf[8 + i] === b);
}

/**
 * Le os primeiros bytes e diz se batem com o tipo declarado.
 * Tipo fora da tabela devolve false: allowlist, nunca o contrario.
 */
async function conteudoBateComTipo(caminho, mime) {
  let fd;
  try {
    fd = await fsp.open(caminho, 'r');
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fd.read(buf, 0, 16, 0);
    if (!bytesRead) return false;

    if (mime === 'image/webp') return ehWebp(buf);
    const esperadas = ASSINATURAS[mime];
    if (!esperadas) return false;
    return esperadas.some((bytes) => comeca(buf, bytes));
  } catch (_) {
    return false;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
}

/**
 * Middleware para usar logo depois do upload.single(). Se o conteudo nao
 * corresponder ao tipo declarado, apaga o arquivo e responde 400.
 */
function conferirAssinatura(req, res, next) {
  const arquivo = req.file;
  if (!arquivo) return next();

  conteudoBateComTipo(arquivo.path, arquivo.mimetype)
    .then((ok) => {
      if (ok) return next();
      // nao deixa lixo no disco quando a validacao falha
      fs.unlink(arquivo.path, () => {});
      req.file = undefined;
      res.status(400).json({ erro: 'O conteúdo do arquivo não corresponde ao tipo informado' });
    })
    .catch((e) => next(e));
}

module.exports = { conferirAssinatura, conteudoBateComTipo };
