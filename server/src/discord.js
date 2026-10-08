// Bot do Blink no Discord: avisa no canal quando alguém entra ao vivo e
// responde /aovivo e /blink. Roda no mesmo processo do servidor.
//
// Sem DISCORD_BOT_TOKEN o bot fica desligado e o resto do app nem percebe.
// O link do aviso é /@usuario — nunca o código da sala — então só amigos
// aceitos conseguem pedir pra entrar, igual ao Web Push.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder,
  Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import { config } from './config.js';

const { token, channelId, guildId } = config.discord;
export const discordEnabled = !!token;

const COLOR = 0xffd23f;
const SOURCE_LABEL = { screen: 'tela', camera: 'câmera' };

const commands = [
  new SlashCommandBuilder().setName('aovivo').setDescription('Quem está ao vivo no Blink agora'),
  new SlashCommandBuilder().setName('blink').setDescription('Link do Blink'),
].map((c) => c.toJSON());

let client = null;
let liveNow = () => [];
// userId → mensagem do aviso, pra marcar "encerrou" quando a live acaba.
const announcements = new Map();

const profileUrl = (username) => `${config.publicUrl}/@${encodeURIComponent(username)}`;

function joinButton(url, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label),
  );
}

function liveEmbed({ name, username, source }) {
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🔴 ${name} está ao vivo no Blink`)
    .setDescription(`Transmitindo a ${SOURCE_LABEL[source] ?? 'tela'}. Amigos podem pedir pra entrar.`)
    .setTimestamp();
  if (username) e.setURL(profileUrl(username));
  return e;
}

async function onInteraction(i) {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === 'blink') {
    await i.reply({
      content: `⚡ ${config.publicUrl}`,
      components: [joinButton(config.publicUrl, 'Abrir o Blink')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (i.commandName === 'aovivo') {
    const list = liveNow();
    if (!list.length) {
      await i.reply({ content: 'Ninguém ao vivo no Blink agora.', flags: MessageFlags.Ephemeral });
      return;
    }
    const lines = list.map((l) => (l.username
      ? `🔴 **${l.name}** — [@${l.username}](${profileUrl(l.username)})`
      : `🔴 **${l.name}**`));
    await i.reply({
      embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Ao vivo no Blink').setDescription(lines.join('\n'))],
    });
  }
}

// `getLiveNow`: () => [{ name, username }] — vem do hub, sem import circular.
export async function startDiscordBot({ getLiveNow }) {
  if (!discordEnabled) {
    console.warn('ℹ️  DISCORD_BOT_TOKEN ausente — bot do Discord desligado.');
    return;
  }
  liveNow = getLiveNow;
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (c) => {
    console.log(`🤖 Bot do Discord conectado como ${c.user.tag}`);
    try {
      // Comandos no servidor aparecem na hora; globais podem levar até 1h.
      if (guildId) await c.application.commands.set(commands, guildId);
      else await c.application.commands.set(commands);
    } catch (err) {
      console.error('discord: falha ao registrar comandos:', err.message);
    }
    if (!channelId) console.warn('ℹ️  DISCORD_CHANNEL_ID ausente — o bot não vai avisar quem entrou ao vivo.');
  });

  client.on(Events.InteractionCreate, (i) => {
    onInteraction(i).catch((err) => console.error('discord:', err.message));
  });
  client.on(Events.Error, (err) => console.error('discord:', err.message));

  // Token errado não derruba o servidor — só fica sem bot.
  await client.login(token).catch((err) => {
    console.error('discord: login falhou:', err.message);
    client = null;
  });
}

export function stopDiscordBot() {
  return client?.destroy();
}

async function announceChannel() {
  if (!client?.isReady() || !channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  return ch?.isTextBased() ? ch : null;
}

export async function announceLive(user, source) {
  const ch = await announceChannel();
  if (!ch) return;
  const msg = await ch.send({
    embeds: [liveEmbed({ name: user.name, username: user.username, source })],
    components: user.username ? [joinButton(profileUrl(user.username), 'Pedir pra entrar')] : [],
  });
  announcements.set(user.id, msg);
}

export async function announceEnded(userId) {
  const msg = announcements.get(userId);
  if (!msg) return;
  announcements.delete(userId);
  const old = msg.embeds[0];
  await msg.edit({
    embeds: [EmbedBuilder.from(old)
      .setColor(0x5c5c66)
      .setTitle(old.title.replace('🔴', '⚫').replace('está ao vivo', 'estava ao vivo'))
      .setDescription('A transmissão acabou.')],
    components: [],
  });
}
