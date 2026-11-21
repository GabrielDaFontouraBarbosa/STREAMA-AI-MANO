// Como o anúncio aparece no canal: ao vivo e encerrado.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const RED = 0xe5484d;
const GRAY = 0x6b7280;

export const WATCH_PREFIX = 'mb:watch:';

function buttons(url, { ended = false, code = '', activity = false } = {}) {
  const row = new ActionRowBuilder();
  // Abre a Activity (a tela dentro do Discord). Só quando a live está no ar.
  if (activity && !ended) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Primary)
        .setCustomId(`${WATCH_PREFIX}${code}`)
        .setLabel('Assistir aqui no Discord')
        .setEmoji('📺'),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setLabel(ended ? 'Live encerrada' : activity ? 'Abrir no navegador' : 'Assistir')
      .setEmoji(ended ? '⚫' : '🌐')
      .setDisabled(ended),
  );
  return row;
}

export function liveMessage({ name, code, title, url, startedAt, activity = false }) {
  const embed = new EmbedBuilder()
    .setColor(RED)
    .setTitle(`🔴 ${name} está ao vivo no Blink`)
    .setDescription(title || 'Chega mais, a tela tá aberta.')
    .addFields({ name: 'Sala', value: `\`${code}\``, inline: true })
    .setFooter({ text: activity ? 'Mini Blink · assista aqui mesmo ou no navegador' : 'Mini Blink · clique em Assistir pra abrir a live' })
    .setTimestamp(new Date(startedAt));
  return { embeds: [embed], components: [buttons(url, { code, activity })], allowedMentions: { parse: [] } };
}

export function endedMessage({ name, code, title, url, startedAt, endedAt = Date.now() }) {
  const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60000));
  const embed = new EmbedBuilder()
    .setColor(GRAY)
    .setTitle(`⚫ A live de ${name} acabou`)
    .setDescription(title || 'Valeu por colar!')
    .addFields(
      { name: 'Sala', value: `\`${code}\``, inline: true },
      { name: 'Duração', value: `${minutes} min`, inline: true },
    )
    .setFooter({ text: 'Mini Blink' })
    .setTimestamp(new Date(endedAt));
  return { embeds: [embed], components: [buttons(url, { ended: true })], allowedMentions: { parse: [] } };
}
