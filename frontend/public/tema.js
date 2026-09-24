/* Aplica o tema salvo antes de a tela pintar, evitando o flash de cor.
   Vive num arquivo separado, e nao embutido no index.html, para a CSP do
   nginx poder proibir script inline sem quebrar isto. */
(function () {
  try {
    var t = localStorage.getItem('colodel-tema') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
