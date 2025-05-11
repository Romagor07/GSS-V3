require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const fs = require('fs');
const Gamedig = require('gamedig');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const servers = require('./config/servers.json');
const messagesPath = './data/messages.json';

const CATEGORY_NAME = 'Мониторинг';
const TEXT_CHANNEL_NAME = 'статус серверов';
const UPDATE_INTERVAL = 60_000;

let messageData = fs.existsSync(messagesPath)
  ? JSON.parse(fs.readFileSync(messagesPath, 'utf-8'))
  : {};

client.once('ready', async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  let channels = await guild.channels.fetch();

  // Категория
  let category = channels.find(c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME);
  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory
    });
    channels = await guild.channels.fetch(); // обновляем список каналов
  }

  // Создаём или находим голосовые каналы
  for (const srv of servers) {
    let voiceChannel = channels.find(c => c.type === ChannelType.GuildVoice && c.name.includes(srv.name) && c.parentId === category.id);
    if (!voiceChannel) {
      voiceChannel = await guild.channels.create({
        name: `🔴 ${srv.name} (Offline)`,
        type: ChannelType.GuildVoice,
        parent: category.id
      });
      channels = await guild.channels.fetch(); // обновляем список каналов
    }
  }

  // Проверяем, существует ли текстовый канал с сохранённым ID
  let textChannel = null;
  if (messageData.textChannelId) {
    textChannel = await guild.channels.fetch(messageData.textChannelId).catch(() => null);
  }

  // Если текстового канала нет, создаём новый и сохраняем его ID
  if (!textChannel) {
    textChannel = await guild.channels.create({
      name: TEXT_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id
    });
    messageData.textChannelId = textChannel.id; // сохраняем ID канала
    fs.writeFileSync(messagesPath, JSON.stringify(messageData, null, 2)); // сохраняем изменения в файл
  }

  // Запускаем цикл обновления состояния
  setInterval(() => updateStatus(guild, category, textChannel), UPDATE_INTERVAL);
  updateStatus(guild, category, textChannel);
});

async function updateStatus(guild, category, textChannel) {
  for (const [i, srv] of servers.entries()) {
    let state = null;
    let online = false;
    let numplayers = 0;
    let maxplayers = srv.maxplayers || 0;
    let map = '';

    try {
      if (srv.type === 'scp') {
        const res = await axios.get('https://api.vodka-pro.ru/status/metro1');
        const data = res.data;

        if (typeof data.online === 'number') {
          online = true;
          numplayers = data.online;
        } else if (data.offline === 0) {
          online = false;
        } else {
          throw new Error('Invalid SCP API response');
        }
      } else {
        state = await Gamedig.query({
          type: 'garrysmod',
          host: srv.ip,
          port: srv.port
        });
        online = true;
        numplayers = state.raw.numplayers;
        maxplayers = state.maxplayers;
        map = state.map;
      }
    } catch {
      online = false;
    }

    // Обновляем голосовой канал
    const voice = guild.channels.cache.find(
      c => c.type === ChannelType.GuildVoice &&
        c.name.includes(srv.name) &&
        c.parentId === category.id
    );

    if (voice) {
      const players = online ? `${numplayers} / ${maxplayers}` : 'Offline';
      await voice.setName(`${online ? '🟢' : '🔴'} ${srv.name} (${players})`);
    }

    // Embed-сообщение
    const embed = new EmbedBuilder()
      .setTitle(`${online ? '🟢' : '🔴'} ${srv.name}`)
      .setColor(['#00ff00', '#ffcc00', '#ff4500'][i] || '#999999')
      .setTimestamp()
      .setFooter({ text: 'Обновлено' });

    if (srv.type === 'metrostroi' && online) {
      const playerList = state.players.map(p => `🔹 ${p.name || '*Подключается ...*'}`).join('\n') || '🔸 На сервере никого нету 😥';
      embed
        .setDescription('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\u200B')
        .setThumbnail(`https://dev.novanautilus.net/images/${map}.jpg`)
        .addFields(
          { name: '🌍 ┃ Карта', value: `🔹 ${map}\n\u200B` },
          { name: `👥 ┃ Игроки ${numplayers}/${maxplayers}`, value: playerList },
          { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' }
        );
    }

    if (srv.type === 'scp') {
      embed.setDescription(online ? `👥 Игроков: ${numplayers}/${maxplayers}` : `🚫 Сервер оффлайн`);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Подключиться')
        .setStyle(ButtonStyle.Link)
        .setURL(srv.connect)
    );

    // Обновление или создание сообщения
    const key = srv.name;
    if (messageData[key]) {
      try {
        const msg = await textChannel.messages.fetch(messageData[key]);
        await msg.edit({ embeds: [embed], components: [row] });
        continue;
      } catch {
        // Сообщение удалено, создаем новое
      }
    }

    const sent = await textChannel.send({ embeds: [embed], components: [row] });
    messageData[key] = sent.id; // сохраняем новый ID
    fs.writeFileSync(messagesPath, JSON.stringify(messageData, null, 2)); // обновляем файл
  }
}

client.login(process.env.TOKEN);
