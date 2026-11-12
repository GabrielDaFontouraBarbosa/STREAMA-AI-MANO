// Bot do Discord do Blink.
//
// Comandos:
//   /vincular              liga sua conta do Discord à do Blink (link só pra você)
//   /desvincular           desfaz a ligação
//   /avisos ligar canal: [cargo:]   (admin) onde avisar quando alguém abre live
//   /avisos desligar       (admin) para os avisos neste servidor
//
// Como ele sabe que alguém abriu live? Olhando a tabela live_streams no banco
// a cada poucos segundos. Por isso o bot roda tanto DENTRO do servidor do
// Blink (Railway) quanto SOZINHO no seu PC (`npm run bot`), desde que aponte
// pro mesmo Postgres. Só não rode os dois com o mesmo token ao mesmo tempo —
// cada aviso sairia duplicado.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder,
  Events, GatewayIntentBits, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import * as links from './links.js';

const POLL_MS = 8_000;
// Queda de conexão / redeploy recria a sala em segundos. Dentro dessa janela
// não é "live nova": não avisa de novo nem marca a antiga como encerrada.
const GRACE_MS = 2 * 60_000;
const RED = 0xff3b5c;
const GREY = 0x5c5f66;
const EPHEMERAL = { flags: MessageFlags.Ephemeral };

const commands = [
  new SlashCommandBuilder()
    .setName('vincular')
    .setDescription('Liga sua conta do Discord à sua conta do Blink'),
  new SlashCommandBuilder()
    .setName('desvincular')
    .setDescription('Desliga sua conta do Discord da conta do Blink'),
  new SlashCommandBuilder()
    .setName('avisos')
    .setDescription('Avisos de live do Blink neste servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s
      .setName('ligar')
      .setDescription('Escolhe o canal (e o cargo a marcar) quando alguém abrir live')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal dos avisos').setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('cargo').setDescription('Cargo marcado em cada aviso (pode ser @everyone)')))
    .addSubcommand((s) => s.setName('desligar').setDescription('Para de avisar neste servidor')),
].map((c) => c.toJSON());

export async function startDiscordBot(token = process.env.DISCORD_TOKEN) {
  if (!token) throw new Error('DISCORD_TOKEN não definido.');

  // Só o intent Guilds: buscar UM membro por id é REST e não precisa do
  // intent privilegiado de membros.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (c) => {
    console.log(`🤖 Bot do Discord on: ${c.user.tag}`);
    console.log(`   Convite: https://discord.com/oauth2/authorize?client_id=${c.user.id}&scope=bot%20applications.commands&permissions=${INVITE_PERMS}`);
    await c.application.commands.set(commands).catch((err) => console.error('discord: registrar comandos:', err.message));
    startWatcher(client);
  });

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand()) return;
    try {
      if (i.commandName === 'vincular') await cmdLink(i);
      else if (i.commandName === 'desvincular') await cmdUnlink(i);
      else if (i.commandName === 'avisos') await cmdAlerts(i);
    } catch (err) {
      console.error('discord:', i.commandName, err);
      const msg = { content: 'Deu ruim aqui. Tenta de novo daqui a pouco.', ...EPHEMERAL };
      (i.deferred || i.replied ? i.followUp(msg) : i.reply(msg)).catch(() => {});
    }
  });

  await client.login(token);
  return client;
}

// View Channel + Send Messages + Embed Links + Mention Everyone
const INVITE_PERMS = (
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages
  | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.MentionEveryone
).toString();

/* ── comandos ────────────────────────────────────────────────── */

async function cmdLink(i) {
  await i.deferReply(EPHEMERAL);
  const current = await links.userOfDiscord(i.user.id);
  const code = await links.createCode(i.user.id);
  const url = `${config.publicUrl}/discord/${code}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Vincular no Blink').setURL(url),
  );
  const intro = current
    ? `Você já está ligado a **@${current.username}**. Abrir o link troca pela conta em que você estiver logado.`
    : 'Abre o link logado no Blink pra ligar as contas.';
  await i.editReply({ content: `${intro}\nO link vale 10 minutos e é só seu — não compartilha.`, components: [row] });
}

async function cmdUnlink(i) {
  const ok = await links.unlinkDiscord(i.user.id);
  await i.reply({ content: ok ? 'Pronto, desvinculei sua conta do Blink.' : 'Sua conta do Discord não está ligada a nenhuma do Blink.', ...EPHEMERAL });
}

async function cmdAlerts(i) {
  if (!i.inGuild()) return i.reply({ content: 'Usa isso dentro de um servidor.', ...EPHEMERAL });
  const sub = i.options.getSubcommand();

  if (sub === 'desligar') {
    await db.delete(schema.discordGuilds).where(eq(schema.discordGuilds.guildId, i.guildId));
    return i.reply({ content: 'Avisos de live desligados neste servidor.', ...EPHEMERAL });
  }

  const channel = i.options.getChannel('canal', true);
  const role = i.options.getRole('cargo');
  const me = await i.guild.members.fetchMe();
  const perms = channel.permissionsFor(me);
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (!perms?.has(needed)) {
    return i.reply({ content: `Não consigo mandar mensagem com embed em ${channel}. Libera **Ver canal**, **Enviar mensagens** e **Inserir links** pro bot lá.`, ...EPHEMERAL });
  }
  let warn = '';
  if (role && (role.id === i.guildId || !role.mentionable) && !perms.has(PermissionFlagsBits.MentionEveryone)) {
    warn = `\n⚠️ Sem a permissão **Mencionar @everyone, @here e todos os cargos**, a marcação de ${role.id === i.guildId ? '@everyone' : role} não vai notificar ninguém.`;
  }

  const values = { guildId: i.guildId, channelId: channel.id, roleId: role?.id ?? null };
  await db.insert(schema.discordGuilds).values(values)
    .onConflictDoUpdate({ target: schema.discordGuilds.guildId, set: { channelId: values.channelId, roleId: values.roleId } });

  await i.reply({
    content: `Fechado! Quando alguém daqui com conta vinculada abrir live no Blink, aviso em ${channel}${role ? ` marcando ${role.id === i.guildId ? '@everyone' : role}` : ''}.`
      + '\nCada pessoa liga a conta dela com `/vincular`.' + warn,
    ...EPHEMERAL,
  });
}

/* ── avisos de live ──────────────────────────────────────────── */

export function startWatcher(client) {
  let seeded = false;
  const active = new Set();      // userIds ao vivo no último giro
  const posts = new Map();       // userId → { messages: Message[], endedAt: number|null }
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const rows = await db.select({
        userId: schema.liveStreams.userId,
        source: schema.liveStreams.source,
        startedAt: schema.liveStreams.startedAt,
        name: schema.user.name,
        username: schema.user.username,
        discordId: schema.discordLinks.discordId,
      })
        .from(schema.liveStreams)
        .innerJoin(schema.user, eq(schema.user.id, schema.liveStreams.userId))
        .leftJoin(schema.discordLinks, eq(schema.discordLinks.userId, schema.liveStreams.userId))
        .where(isNull(schema.liveStreams.endedAt));

      const now = Date.now();
      const current = new Set(rows.map((r) => r.userId));

      if (!seeded) {
        // Quem já estava ao vivo quando o bot ligou não ganha aviso atrasado.
        for (const id of current) active.add(id);
        seeded = true;
        return;
      }

      for (const r of rows) {
        if (active.has(r.userId)) continue;
        active.add(r.userId);
        const prev = posts.get(r.userId);
        if (prev?.endedAt && now - prev.endedAt < GRACE_MS) { prev.endedAt = null; continue; } // voltou da queda
        if (!r.discordId) continue;
        const messages = await announce(client, r);
        if (messages.length) posts.set(r.userId, { messages, endedAt: null, row: r });
      }

      for (const id of [...active]) {
        if (current.has(id)) continue;
        active.delete(id);
        const p = posts.get(id);
        if (p) p.endedAt = now;
      }

      for (const [id, p] of posts) {
        if (p.endedAt && now - p.endedAt >= GRACE_MS) {
          posts.delete(id);
          await markEnded(p).catch(() => {});
        }
      }
    } catch (err) {
      console.error('discord watcher:', err.message);
    } finally {
      running = false;
    }
  }

  tick();
  setInterval(tick, POLL_MS).unref();
}

async function announce(client, r) {
  const guilds = await db.select().from(schema.discordGuilds);
  const sent = [];
  for (const g of guilds) {
    try {
      const guild = client.guilds.cache.get(g.guildId);
      if (!guild) continue;
      // Só avisa nos servidores onde a pessoa realmente está.
      const member = await guild.members.fetch(r.discordId).catch(() => null);
      if (!member) continue;
      const channel = await client.channels.fetch(g.channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;

      const everyone = g.roleId === g.guildId;
      const ping = g.roleId ? (everyone ? '@everyone ' : `<@&${g.roleId}> `) : '';
      const msg = await channel.send({
        content: `${ping}🔴 <@${r.discordId}> abriu live no Blink!`,
        embeds: [liveEmbed(r, member)],
        components: r.username ? [watchButton(r.username)] : [],
        // Marca o cargo escolhido; o próprio streamer aparece marcado mas não leva ping.
        allowedMentions: { parse: everyone ? ['everyone'] : [], roles: g.roleId && !everyone ? [g.roleId] : [], users: [] },
      });
      sent.push(msg);
    } catch (err) {
      console.error(`discord: aviso no servidor ${g.guildId}:`, err.message);
    }
  }
  return sent;
}

function liveEmbed(r, member) {
  return new EmbedBuilder()
    .setColor(RED)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setTitle(`${r.name} está ao vivo`)
    .setURL(r.username ? `${config.publicUrl}/@${r.username}` : config.publicUrl)
    .setDescription(`Transmitindo ${r.source === 'camera' ? 'a câmera' : 'a tela'}. Amigos no Blink podem pedir pra entrar.`)
    .setTimestamp(r.startedAt);
}

function watchButton(username) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Assistir no Blink').setURL(`${config.publicUrl}/@${username}`),
  );
}

async function markEnded(p) {
  const mins = Math.max(1, Math.round((p.endedAt - new Date(p.row.startedAt).getTime()) / 60_000));
  for (const m of p.messages) {
    const embed = EmbedBuilder.from(m.embeds[0]).setColor(GREY)
      .setTitle(`${p.row.name} estava ao vivo`)
      .setDescription(`A live acabou (durou ~${mins} min).`);
    await m.edit({ content: `⚫ <@${p.row.discordId}> encerrou a live.`, embeds: [embed], components: [], allowedMentions: { parse: [] } }).catch(() => {});
  }
}
