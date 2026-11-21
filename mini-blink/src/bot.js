// Mini Blink — bot do Discord que anuncia sua live do Blink no canal.
//
// startBot(env) liga o bot. Roda sozinho (npm start, src/index.js) ou dentro
// do servidor do Blink (server/index.js), pra ficar no ar 24h no Render.
//
//   /live codigo:AB12CD [titulo:...]  → posta o anúncio com o botão "Assistir"
//   /encerrar                          → marca suas lives como encerradas
//
// O bot checa o Blink de tempos em tempos e, quando a sala fecha, troca o
// anúncio para "live encerrada" sozinho.
//
// Dentro do Discord a live abre numa Activity. Como Activities não suportam
// WebRTC ("WebRTC is not supported" — docs de networking), o Blink manda o
// vídeo pra ela por WebSocket (server/src/relay.js) e ela decodifica com
// WebCodecs (public/discord/viewer.js).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Client, Events, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder,
} from 'discord.js';
import { createBlinkClient, normalizeCode } from './blink.js';
import { createStore } from './store.js';
import { endedMessage, liveMessage, WATCH_PREFIX } from './messages.js';

const DEFAULT_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function startBot(env = process.env, { dataDir = DEFAULT_DATA_DIR } = {}) {
  for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'BLINK_URL']) {
    if (!env[key]) throw new Error(`Mini Blink: falta ${key} (veja mini-blink/.env.example).`);
  }
  let timer = null;

  // Com o segredo, o bot mostra "Assistir aqui no Discord" (Activity). Sem ele,
  // fica só o botão que abre o navegador.
  const SECRET = env.MINI_BLINK_SECRET || '';
  const ACTIVITY = !!SECRET && env.MINI_BLINK_ACTIVITY !== '0';

  const CHECK_INTERVAL_MS = Math.max(10, Number(env.CHECK_INTERVAL || 20)) * 1000;
  const MAX_LIVE_MS = 12 * 60 * 60 * 1000; // anúncio esquecido some sozinho depois de 12h
  const CLOSED_CHECKS_TO_END = 2;          // evita encerrar por um soluço do Blink

  const blink = createBlinkClient(env.BLINK_URL);
  const store = createStore(path.join(dataDir, 'lives.json'));

  const commands = [
    new SlashCommandBuilder()
      .setName('live')
      .setDescription('Anuncia sua live do Blink neste canal')
      .addStringOption((o) => o.setName('codigo').setDescription('Código da sala (ex.: AB12CD) ou o link /s/...').setRequired(true))
      .addStringOption((o) => o.setName('titulo').setDescription('Do que é a live?').setMaxLength(200)),
    new SlashCommandBuilder()
      .setName('encerrar')
      .setDescription('Marca suas lives anunciadas como encerradas'),
  ].map((c) => c.toJSON());

  async function registerCommands() {
    const rest = new REST().setToken(env.DISCORD_TOKEN);
    const route = env.DISCORD_GUILD_ID
      ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
      : Routes.applicationCommands(env.DISCORD_CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log(`Comandos registrados (${env.DISCORD_GUILD_ID ? 'no servidor' : 'globais — podem levar até 1h'}).`);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  async function endLive(live) {
    try {
      const channel = await client.channels.fetch(live.channelId);
      const message = await channel.messages.fetch(live.messageId);
      await message.edit(endedMessage({ ...live, endedAt: Date.now() }));
    } catch (err) {
      // Mensagem ou canal apagado, ou sem permissão: só esquece.
      console.warn(`Não consegui atualizar o anúncio ${live.messageId}: ${err.message}`);
    }
    store.remove(live.messageId);
  }

  // Posta o anúncio num canal e passa a acompanhar a sala. Usado pelo /live e
  // pelo botão "Mandar no Discord" do Blink (announce).
  async function publish(channel, { userId, name, code, title = '', mention = false }) {
    // Uma live por pessoa por canal: encerra o anúncio anterior.
    for (const old of store.byUser(userId).filter((l) => l.channelId === channel.id)) {
      await endLive(old);
    }
    const live = {
      userId,
      name,
      channelId: channel.id,
      code,
      title,
      url: blink.roomUrl(code),
      startedAt: Date.now(),
      closedChecks: 0,
      activity: ACTIVITY,
    };
    // Plano B pra Activity: abrindo neste canal, já sabe a sala.
    if (ACTIVITY) blink.link({ code, channelId: channel.id, secret: SECRET });
    const payload = liveMessage(live);
    // Menção só pra aparecer o nome clicável; allowedMentions vazio = ninguém é pingado.
    if (mention) payload.content = `<@${userId}> abriu uma live!`;
    const message = await channel.send(payload);
    store.add({ ...live, messageId: message.id });
    return message;
  }

  // Botão "Mandar no Discord" do Blink: posta no canal de lives configurado
  // (DISCORD_LIVE_CHANNEL_ID) em nome de quem vinculou a conta.
  const LIVE_CHANNEL_ID = env.DISCORD_LIVE_CHANNEL_ID || '';

  function canAnnounce() {
    return !!LIVE_CHANNEL_ID && client.isReady();
  }

  async function announce({ discordUserId, code, title = '' }) {
    if (!LIVE_CHANNEL_ID) return { ok: false, error: 'no_channel' };
    if (!client.isReady()) return { ok: false, error: 'bot_offline' };
    let channel;
    try {
      channel = await client.channels.fetch(LIVE_CHANNEL_ID);
    } catch {
      return { ok: false, error: 'no_channel' };
    }
    if (!channel?.guild || !channel.isTextBased?.()) return { ok: false, error: 'no_channel' };

    let member;
    try {
      member = await channel.guild.members.fetch(discordUserId);
    } catch {
      return { ok: false, error: 'not_member', guild: channel.guild.name };
    }

    // Já anunciou esta mesma sala aqui: não repete.
    const same = store.byUser(discordUserId).find((l) => l.channelId === channel.id && l.code === code);
    if (same) return { ok: true, already: true, guild: channel.guild.name, channel: channel.name };

    try {
      await publish(channel, { userId: discordUserId, name: member.displayName, code, title, mention: true });
    } catch (err) {
      console.warn(`Mini Blink: não consegui postar em ${channel.id}: ${err.message}`);
      return { ok: false, error: 'no_permission', guild: channel.guild.name };
    }
    return { ok: true, guild: channel.guild.name, channel: channel.name };
  }

  async function handleLive(interaction) {
    const code = normalizeCode(interaction.options.getString('codigo', true));
    const title = interaction.options.getString('titulo') ?? '';
    if (!code) {
      return interaction.reply({ content: 'Código inválido. É o código de 6 letras/números da sala (ex.: `AB12CD`) ou o link `/s/...`.', flags: MessageFlags.Ephemeral });
    }

    // O Blink pode estar dormindo (plano grátis): a checagem pode passar de 3s.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const open = await blink.isOpen(code);
    if (open === false) {
      return interaction.editReply(`A sala \`${code}\` não está no ar. Comece a transmitir no Blink e mande o comando de novo.`);
    }

    try {
      await publish(interaction.channel, {
        userId: interaction.user.id,
        name: interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username,
        code,
        title,
      });
    } catch (err) {
      console.warn(`Sem permissão para postar em ${interaction.channelId}: ${err.message}`);
      return interaction.editReply('Não consegui postar neste canal. O bot precisa de **Ver canal**, **Enviar mensagens** e **Inserir links** aqui.');
    }

    await interaction.editReply(open === null
      ? `Anunciado! (O Blink não respondeu agora, mas o link já está no canal.)`
      : 'Anunciado! Quando a sala fechar, o anúncio vira "live encerrada" sozinho.');
  }

  async function handleEncerrar(interaction) {
    const mine = store.byUser(interaction.user.id);
    for (const live of mine) await endLive(live);
    await interaction.reply({
      content: mine.length ? `Pronto, ${mine.length === 1 ? 'anúncio encerrado' : `${mine.length} anúncios encerrados`}.` : 'Você não tem nenhuma live anunciada agora.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Botão "Assistir aqui no Discord": abre a Activity e conta pro Blink qual
  // sala é a desta instância. Tem que responder em até 3s, então nada de
  // esperar o Blink antes de abrir.
  async function handleWatchButton(interaction) {
    const code = interaction.customId.slice(WATCH_PREFIX.length).toUpperCase();
    const res = await interaction.launchActivity({ withResponse: true });
    const instanceId = res?.resource?.activityInstance?.id;
    await blink.link({ code, instanceId, channelId: interaction.channelId, secret: SECRET });
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith(WATCH_PREFIX)) {
      try {
        await handleWatchButton(interaction);
      } catch (err) {
        console.error('Activity:', err.message);
        if (!interaction.replied) {
          await interaction.reply({
            content: 'Não deu pra abrir a tela aqui (as Activities estão ligadas no portal do Discord?). Use **Abrir no navegador**.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild() || !interaction.channel) {
      return interaction.reply({ content: 'Use o Mini Blink num canal de servidor.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    try {
      if (interaction.commandName === 'live') await handleLive(interaction);
      else if (interaction.commandName === 'encerrar') await handleEncerrar(interaction);
    } catch (err) {
      console.error(err);
      const reply = { content: 'Deu ruim aqui. Tenta de novo em instantes.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  });

  let checking = false;
  async function checkLives() {
    if (checking) return;
    checking = true;
    try {
      for (const live of store.all()) {
        if (Date.now() - live.startedAt > MAX_LIVE_MS) { await endLive(live); continue; }
        const open = await blink.isOpen(live.code);
        if (open === true && live.closedChecks) store.update(live.messageId, { closedChecks: 0 });
        if (open === false) {
          const closedChecks = (live.closedChecks || 0) + 1;
          if (closedChecks >= CLOSED_CHECKS_TO_END) await endLive(live);
          else store.update(live.messageId, { closedChecks });
        }
        // open === null: Blink não respondeu — não muda nada.
      }
    } finally {
      checking = false;
    }
  }

  client.once(Events.ClientReady, async (c) => {
    console.log(`⚡ Mini Blink online como ${c.user.tag} — Blink: ${blink.base} — tela no Discord: ${ACTIVITY ? 'ligada' : 'desligada (defina MINI_BLINK_SECRET)'}`);
    try {
      await registerCommands();
    } catch (err) {
      console.error('Falha ao registrar comandos:', err.message);
    }
    timer = setInterval(checkLives, CHECK_INTERVAL_MS);
    checkLives();
  });

  client.login(env.DISCORD_TOKEN).catch((err) => console.error('Mini Blink: login no Discord falhou —', err.message));

  return {
    client,
    announce,
    canAnnounce,
    async stop() {
      clearInterval(timer);
      await client.destroy();
    },
  };
}
