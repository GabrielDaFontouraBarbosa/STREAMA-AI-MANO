/* ═══════════════════════════════════════════════════════════
   Mini Blink — regras puras do player da Activity
   (sem DOM: testadas em tests/unit/player-logic.test.js)
   ═══════════════════════════════════════════════════════════ */

// O que define o decoder de vídeo. Se isto não muda, o decoder fica: uma
// config que só traz o áudio não pode reiniciar o vídeo.
export function videoSignature(video) {
  if (!video) return null;
  return JSON.stringify([video.codec, video.width ?? video.codedWidth, video.height ?? video.codedHeight, video.descriptionB64 ?? '']);
}

export function audioSignature(audio) {
  if (!audio) return null;
  return JSON.stringify([audio.codec, audio.sampleRate, audio.numberOfChannels, audio.descriptionB64 ?? '']);
}

// Junta a config recebida com a atual. Campo ausente mantém a trilha; `null`
// desliga; objeto substitui. Diz o que precisa ser reconfigurado.
export function mergeConfig(previous, patch) {
  const prev = previous ?? { video: null, audio: null };
  const has = (k) => Object.prototype.hasOwnProperty.call(patch ?? {}, k);
  const video = has('video') ? patch.video : prev.video;
  const audio = has('audio') ? patch.audio : prev.audio;
  return {
    next: { video, audio },
    reconfigureVideo: videoSignature(prev.video) !== videoSignature(video),
    reconfigureAudio: audioSignature(prev.audio) !== audioSignature(audio),
  };
}

// Falhas do decoder de vídeo: tenta de novo até `max` vezes; depois desiste
// (o player mostra "Abrir no navegador"). Só zera depois de `healthyMs` de
// imagem saindo sem erro — um quadro solto entre erros não conta.
export function createFailureTracker({ max = 3, healthyMs = 10000, now = () => Date.now() } = {}) {
  let failures = 0;
  let healthySince = null;
  let gaveUp = false;

  return {
    get failures() { return failures; },
    get gaveUp() { return gaveUp; },

    frame() {
      if (gaveUp) return;
      const t = now();
      if (healthySince === null) healthySince = t;
      if (failures && t - healthySince >= healthyMs) failures = 0;
    },

    // 'retry' = reinicia o decoder; 'give-up' = para de tentar.
    fail() {
      healthySince = null;
      if (gaveUp) return 'give-up';
      failures++;
      if (failures >= max) { gaveUp = true; return 'give-up'; }
      return 'retry';
    },

    // "Tentar de novo" escolhido pela pessoa.
    reset() { failures = 0; healthySince = null; gaveUp = false; },
  };
}
