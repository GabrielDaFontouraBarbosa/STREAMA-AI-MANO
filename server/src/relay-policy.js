// Decisão por pacote e por viewer no relay (testada em tests/unit).
//
// Histerese: com a fila acima de 1,5 MiB (projetada) o viewer para de
// receber vídeo e espera um keyframe; só volta com um keyframe e com a fila
// já abaixo de 512 KiB. Acima de 8 MiB a conexão é fechada, mesmo com áudio.
// O áudio passa durante o congestionamento moderado.

export const LOW_WATER = 512 * 1024;
export const SOFT_LIMIT = 1536 * 1024;
export const HARD_LIMIT = 8 * 1024 * 1024;

// kind: 'audio' | 'key' | 'delta'
export function decidePacket(queued, size, waitingForKey, kind) {
  if (![queued, size].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !['audio', 'key', 'delta'].includes(kind)) {
    throw new RangeError('Pacote inválido');
  }
  const projected = queued + size;
  if (projected >= HARD_LIMIT) return { action: 'close', waitingForKey: true };
  if (kind === 'audio') return { action: 'send', waitingForKey };
  if (projected >= SOFT_LIMIT || (waitingForKey && (kind !== 'key' || queued > LOW_WATER))) {
    return { action: 'drop', waitingForKey: true };
  }
  return { action: 'send', waitingForKey: false };
}

// Mesma assinatura usada pelo player (public/discord/player-logic.js):
// o que obriga o viewer a esperar um keyframe novo.
export function videoSignature(video) {
  if (!video) return null;
  return JSON.stringify([video.codec, video.width ?? video.codedWidth, video.height ?? video.codedHeight, video.descriptionB64 ?? '']);
}
