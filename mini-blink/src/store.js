// Lives anunciadas, salvas num JSON pra sobreviver a um reinício do bot.
// Chave: id da mensagem no Discord.

import fs from 'node:fs';
import path from 'node:path';

export function createStore(file) {
  let lives = {};
  try {
    lives = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    lives = {};
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lives, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    all: () => Object.values(lives),
    add(live) { lives[live.messageId] = live; save(); },
    update(messageId, patch) {
      if (!lives[messageId]) return;
      lives[messageId] = { ...lives[messageId], ...patch };
      save();
    },
    remove(messageId) { delete lives[messageId]; save(); },
    byUser: (userId) => Object.values(lives).filter((l) => l.userId === userId),
  };
}
