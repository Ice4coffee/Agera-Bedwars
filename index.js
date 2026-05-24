// index.js
require('dotenv').config();

const {
    Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField
} = require('discord.js');
const axios = require('axios');
const readline = require('readline');

// ---------- Переменные окружения ----------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const AGERA_API_KEY = process.env.AGERA_API_KEY;
const AGERA_API_BASE_URL = process.env.AGERA_API_BASE_URL || 'https://api.agerapvp.club';
const GAME_MODE = process.env.GAME_MODE || 'BW';
const PROFILE_NAME_FIELD = process.env.PROFILE_NAME_FIELD || 'displayName';
const LEVEL_EXP_DIVIDER = parseInt(process.env.LEVEL_EXP_DIVIDER) || 5000;
const LEADERBOARD_INTERVAL_MIN = parseInt(process.env.LEADERBOARD_UPDATE_INTERVAL_MIN) || 30;
const LB_FIELDS = process.env.LB_FIELDS ? process.env.LB_FIELDS.split(',').map(f => f.trim()) : ['wins', 'kills', 'final_kills', 'beds', 'experience'];
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_ARCHIVE_ID = process.env.TICKET_ARCHIVE_ID;
const CONSOLE_CHANNEL_ID = process.env.CONSOLE_CHANNEL_ID;

// Тексты по умолчанию (можно переопределить в .env)
const defaultMediaText = `AgeraBedwars Discord гордится тем, что сотрудничает с создателями контента!...`;
const defaultHelpText = `**Заявка на Хелпера**...`;
const defaultIdeaText = `**Предложить идею или функцию**...`;
const defaultPartnerText = `**Партнёрские заявки**...`;
const defaultRolesText = `# ✦ Категории Ролей...`;
const defaultTournamentText = `Долго меня не было на ютубе.... 
Но я решил, что мы месте с MANCHAOS открываем регистрацию на турнир

По BEDWARS DOUBLES🏆

✨ А так же будет прямая трансляция турнира.
В турнире могут участвовать ВСЕ

🎮 Вас ждет много эмоций, а ещё конечно же, ценные призы!

💰 Призовой фонд - 4000 ₽

🥇 1 место: RUBIUM на 1 месяц
🥈 2 место: MASTER на 1 месяц
🥉 3 место: DELUXE на 1 месяц

Донат будет выдаваться КАЖДОМУ победителю

〰〰〰〰〰〰〰〰〰〰〰 

🏁 Формат Турнира - Кросс Мап 2х2

〰〰〰〰〰〰〰〰〰〰〰

ЗАЯВКИ ПОДАВАТЬ ЧЕРЕЗ
@weq5555

〰〰〰〰〰〰〰〰〰〰〰

ФОРМА ПОДАЧИ ЗАЯВКИ

Название команды
Участники (2 человека)
Ваш @username и тимейта`;

// Хранилище ID сообщений панелей
const panelMessages = new Map();

// ---------- Проверка ----------
if (!DISCORD_TOKEN) { console.error('❌ DISCORD_TOKEN'); process.exit(1); }
if (!VERIFIED_ROLE_ID) { console.error('❌ VERIFIED_ROLE_ID'); process.exit(1); }
if (!AGERA_API_KEY) console.warn('⚠️ AGERA_API_KEY');

// ---------- Клиент ----------
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
});

// ---------- Вспомогательные ----------
function cleanMinecraftName(raw) { return raw.replace(/§[0-9a-fk-or]/gi, ''); }
async function safeDelete(message, timeout = 0) {
    if (timeout > 0) await new Promise(r => setTimeout(r, timeout));
    try { await message.delete(); } catch (err) { if (err.code !== 10008) console.error('Delete error:', err.message); }
}

function findChannelByName(guild, name) {
    const cleanName = name.replace(/^#/, '').toLowerCase().trim();
    let channel = guild.channels.cache.find(c => c.name.toLowerCase().trim() === cleanName && c.type === ChannelType.GuildText);
    if (!channel) channel = guild.channels.cache.find(c => c.name.toLowerCase().includes(cleanName) && c.type === ChannelType.GuildText);
    return channel || null;
}

// ---------- API ----------
const buildStatsUrl = (n) => `${AGERA_API_BASE_URL}/v1/player/stats/${encodeURIComponent(n)}/${GAME_MODE}`;
const buildProfileUrl = (n) => `${AGERA_API_BASE_URL}/v1/player/profile/${encodeURIComponent(n)}`;
const buildTopUrl = (m, f) => `${AGERA_API_BASE_URL}/v1/core/top/${encodeURIComponent(m)}/${encodeURIComponent(f)}`;

async function fetchTop(mode, field) {
    const { data } = await axios.get(buildTopUrl(mode, field), { headers: { 'X-Api-Key': AGERA_API_KEY }, timeout: 5000 });
    return data;
}

function formatTopEmbed(mode, field, data) {
    const top = data.top;
    if (!top || Object.keys(top).length === 0) return new EmbedBuilder().setColor(0xe67e22).setTitle(`📊 Топ ${mode} – ${field}`).setDescription('Нет данных.').setTimestamp();
    const sorted = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const desc = sorted.map(([p, v], i) => `**${i + 1}.** ${cleanMinecraftName(p)} — \`${v}\``).join('\n');
    return new EmbedBuilder().setColor(0xf1c40f).setTitle(`📊 Топ ${mode} – ${field}`).setDescription(desc).setFooter({ text: `Обновляется каждые ${LEADERBOARD_INTERVAL_MIN} мин.` }).setTimestamp();
}

// ---------- Лидерборд ----------
let leaderboardMessageId = null, leaderboardChannelId = null, leaderboardInterval = null, currentField = LB_FIELDS[0];

function buildSelectMenu() {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('leaderboard_select').setPlaceholder('Выберите категорию').addOptions(LB_FIELDS.map(f => ({ label: f, value: f }))));
}

async function refreshLeaderboardMessage() {
    if (!leaderboardChannelId || !leaderboardMessageId) return;
    try {
        const ch = await client.channels.fetch(leaderboardChannelId);
        const msg = await ch.messages.fetch(leaderboardMessageId);
        const topData = await fetchTop(GAME_MODE, currentField);
        await msg.edit({ embeds: [formatTopEmbed(GAME_MODE, currentField, topData)], components: [buildSelectMenu()] });
    } catch (err) { console.error('Ошибка обновления лидерборда:', err.message); }
}

function startLeaderboardInterval() {
    if (leaderboardInterval) clearInterval(leaderboardInterval);
    if (leaderboardChannelId && leaderboardMessageId) leaderboardInterval = setInterval(refreshLeaderboardMessage, LEADERBOARD_INTERVAL_MIN * 60 * 1000);
}

// ---------- Достижения ----------
const ACHIEVEMENT_THRESHOLDS = [0, 30, 60, 120, 250, 400, 800, 1500, 3000, 8000];
let achievementRoleIds = process.env.ACHIEVEMENT_ROLES_IDS ? process.env.ACHIEVEMENT_ROLES_IDS.split(',').map(id => id.trim()) : [];

async function updateAchievementRoles(member, wins) {
    if (!achievementRoleIds.length) return;
    let idx = 0;
    for (let i = 0; i < ACHIEVEMENT_THRESHOLDS.length; i++) if (wins >= ACHIEVEMENT_THRESHOLDS[i]) idx = i;
    const targetId = achievementRoleIds[idx];
    if (!targetId) return;
    try {
        const guild = member.guild;
        const roleToAdd = await guild.roles.fetch(targetId);
        if (!roleToAdd) return;
        const toRemove = [];
        for (const id of achievementRoleIds) if (id !== targetId && member.roles.cache.has(id)) { const r = await guild.roles.fetch(id).catch(() => null); if (r) toRemove.push(r); }
        if (toRemove.length) await member.roles.remove(toRemove);
        if (!member.roles.cache.has(targetId)) await member.roles.add(roleToAdd);
        console.log(`✅ Достижения: ${wins} побед`);
    } catch (err) { console.error('Ошибка достижений:', err); }
}

// ---------- Верификация ----------
async function handleVerification(interaction, nickname) {
    await interaction.deferReply({ flags: 64 });
    try {
        const statsRes = await axios.get(buildStatsUrl(nickname), { headers: { 'X-Api-Key': AGERA_API_KEY }, timeout: 5000 });
        const values = statsRes.data?.values;
        if (!values) throw new Error('Нет values');
        const experience = parseInt(values.experience), wins = parseInt(values.wins) || 0;
        if (isNaN(experience)) return interaction.editReply({ content: '❌ Нет опыта.' });
        const level = Math.floor(experience / LEVEL_EXP_DIVIDER);
        let displayName = nickname;
        try {
            const profileRes = await axios.get(buildProfileUrl(nickname), { headers: { 'X-Api-Key': AGERA_API_KEY }, timeout: 5000 });
            const profile = profileRes.data;
            if (profile?.[PROFILE_NAME_FIELD]) displayName = cleanMinecraftName(profile[PROFILE_NAME_FIELD]);
        } catch (e) {}
        const member = interaction.member;
        await updateAchievementRoles(member, wins);
        try { await member.roles.add(await interaction.guild.roles.fetch(VERIFIED_ROLE_ID)); } catch (e) {}
        try { await member.setNickname(`[${level}] ${displayName}`); } catch (e) { if (e.code !== 50013) console.error('Ошибка ника:', e); }
        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Верификация').setDescription(`**${displayName}**\nУровень: **${level}**\nПобед: **${wins}**`).setTimestamp();
        await interaction.editReply({ embeds: [embed], flags: 64 });
    } catch (err) {
        if (err.response?.status === 404) await interaction.editReply({ content: `❌ Игрок **${nickname}** не найден.`, flags: 64 });
        else if (err.code === 'ECONNABORTED') await interaction.editReply({ content: '❌ Таймаут.', flags: 64 });
        else { console.error('Ошибка:', err); await interaction.editReply({ content: '❌ Ошибка.', flags: 64 }); }
    }
}

// ---------- Тикеты ----------
const ticketTemplates = {
    helper: { title: '🎫 Хелпер', content: process.env.TICKET_HELPER_TEXT || defaultHelpText },
    idea: { title: '💡 Идея', content: process.env.TICKET_IDEA_TEXT || defaultIdeaText },
    partner: { title: '🤝 Партнёрство', content: process.env.TICKET_PARTNER_TEXT || defaultPartnerText }
};

async function createTicket(interaction, type) {
    if (!TICKET_CATEGORY_ID) return interaction.reply({ content: '❌ Тикеты не настроены.', flags: 64 });
    const guild = interaction.guild, member = interaction.member;
    const name = `${type}-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const category = await guild.channels.fetch(TICKET_CATEGORY_ID);
    if (!category || category.type !== ChannelType.GuildCategory) return interaction.reply({ content: '❌ Категория не найдена.', flags: 64 });
    try {
        const ch = await guild.channels.create({
            name, type: ChannelType.GuildText, parent: TICKET_CATEGORY_ID,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: member.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            ],
        });
        if (STAFF_ROLE_ID) { const sr = await guild.roles.fetch(STAFF_ROLE_ID).catch(() => null); if (sr) await ch.permissionOverwrites.edit(sr, { ViewChannel: true, SendMessages: true }); }
        const tpl = ticketTemplates[type];
        if (tpl) {
            const embed = new EmbedBuilder().setColor(0x3498db).setTitle(tpl.title).setDescription(tpl.content).setFooter({ text: 'Заполните форму выше.' });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`close_ticket_${ch.id}`).setLabel('Закрыть').setStyle(ButtonStyle.Danger));
            await ch.send({ content: `<@${member.user.id}>, тикет создан.`, embeds: [embed], components: [row] });
        }
        await interaction.reply({ content: `✅ Тикет: ${ch}`, flags: 64 });
    } catch (err) { console.error('Ошибка тикета:', err); interaction.reply({ content: '❌ Ошибка.', flags: 64 }); }
}

// ---------- Отправка в канал ----------
async function sendToChannel(guild, channelIdentifier, text) {
    let targetChannel = null;
    if (/^\d+$/.test(channelIdentifier)) {
        targetChannel = await guild.channels.fetch(channelIdentifier).catch(() => null);
    } else {
        targetChannel = findChannelByName(guild, channelIdentifier);
    }
    if (!targetChannel) return { ok: false, error: `Канал "${channelIdentifier}" не найден.` };
    await targetChannel.send(text);
    return { ok: true, channelName: targetChannel.name };
}

// ---------- Функция для отправки/обновления панели ----------
async function sendOrUpdatePanel(channel, type, embed, components = []) {
    const key = `${channel.id}-${type}`;
    const existingId = panelMessages.get(key);
    try {
        if (existingId) {
            const msg = await channel.messages.fetch(existingId);
            await msg.edit({ embeds: [embed], components });
            return msg;
        }
    } catch (e) { /* сообщение удалено */ }
    const msg = await channel.send({ embeds: [embed], components });
    panelMessages.set(key, msg.id);
    return msg;
}

// ---------- Готовность ----------
client.once('ready', async () => {
    console.log(`✅ Бот ${client.user.tag} запущен.`);
    const guild = client.guilds.cache.first();

    if (CONSOLE_CHANNEL_ID && guild) {
        try {
            const defaultChannel = await client.channels.fetch(CONSOLE_CHANNEL_ID);
            console.log(`💬 Консольный чат → #${defaultChannel.name}`);
            console.log('   #канал текст | /embed #канал {...} | /reply #канал <id> текст');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '💬> ' });
            rl.prompt();
            rl.on('line', async (line) => {
                const input = line.trim();
                if (!input) { rl.prompt(); return; }
                try {
                    if (input.startsWith('/embed ')) {
                        const m = input.slice(7).trim().match(/^#(.+?)\s+(\{.+)/);
                        if (m) {
                            const ch = findChannelByName(guild, m[1]);
                            if (ch) { await ch.send({ embeds: [new EmbedBuilder(JSON.parse(m[2]))] }); console.log(`✅ Embed → #${ch.name}`); }
                            else console.log(`❌ Канал #${m[1]} не найден.`);
                        }
                    } else if (input.startsWith('/reply ')) {
                        const m = input.slice(7).trim().match(/^#(.+?)\s+(\d+)\s+(.+)/);
                        if (m) {
                            const ch = findChannelByName(guild, m[1]);
                            if (ch) { const msg = await ch.messages.fetch(m[2]); await msg.reply(m[3]); console.log(`✅ Ответ → #${ch.name}`); }
                            else console.log(`❌ Канал #${m[1]} не найден.`);
                        }
                    } else {
                        const m = input.match(/^#(.+?)\s+(.+)/);
                        if (m) {
                            const ch = findChannelByName(guild, m[1]);
                            if (ch) { await ch.send(m[2]); console.log(`✅ → #${ch.name}`); }
                            else console.log(`❌ Канал #${m[1]} не найден.`);
                        } else {
                            await defaultChannel.send(input);
                            console.log(`✅ → #${defaultChannel.name}`);
                        }
                    }
                } catch (err) { console.error('❌', err.message); }
                rl.prompt();
            });
        } catch (err) { console.error('❌ Консольный чат:', err.message); }
    }
});

// ---------- Сообщения ----------
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const { content, channel, member, guild } = message;

    if (content.startsWith('!send ')) {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply({ content: '❌ Только для администраторов.', flags: 64 });
        const args = content.slice(6).trim().match(/^(#\S+|<#\d+>|\d+)\s+(.+)/);
        if (!args) return message.reply({ content: '❌ Формат: `!send #канал текст`', flags: 64 });
        let channelId = args[1];
        if (channelId.startsWith('<#') && channelId.endsWith('>')) channelId = channelId.slice(2, -1);
        else if (channelId.startsWith('#')) channelId = channelId.slice(1);
        const result = await sendToChannel(guild, channelId, args[2]);
        if (result.ok) await message.reply({ content: `✅ Отправлено в #${result.channelName}`, flags: 64 });
        else await message.reply({ content: `❌ ${result.error}`, flags: 64 });
        return;
    }

    // === Информационные панели с возможностью редактирования ===
    if (content.trim() === '!setup-media') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const text = process.env.MEDIA_INFO_TEXT || defaultMediaText;
        const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle('📢 Медиа и партнёры').setDescription(text).setFooter({ text: 'По вопросам сотрудничества обращайтесь к администрации.' });
        await sendOrUpdatePanel(channel, 'media', embed);
        return;
    }

    if (content.trim() === '!setup-help') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const text = process.env.HELP_INFO_TEXT || defaultHelpText;
        const embed = new EmbedBuilder().setColor(0x3498db).setTitle('🎫 Заявка на Хелпера').setDescription(text);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_helper').setLabel('🎫 Подать заявку').setStyle(ButtonStyle.Primary));
        await sendOrUpdatePanel(channel, 'help', embed, [row]);
        return;
    }

    if (content.trim() === '!setup-idea') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const text = process.env.IDEA_INFO_TEXT || defaultIdeaText;
        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('💡 Предложить идею').setDescription(text);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_idea').setLabel('💡 Предложить идею').setStyle(ButtonStyle.Success));
        await sendOrUpdatePanel(channel, 'idea', embed, [row]);
        return;
    }

    if (content.trim() === '!setup-partner') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const text = process.env.PARTNER_INFO_TEXT || defaultPartnerText;
        const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🤝 Партнёрская заявка').setDescription(text);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_partner').setLabel('🤝 Подать заявку').setStyle(ButtonStyle.Secondary));
        await sendOrUpdatePanel(channel, 'partner', embed, [row]);
        return;
    }

    if (content.trim() === '!setup-roles') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const text = process.env.ROLES_INFO_TEXT || defaultRolesText;
        const embed = new EmbedBuilder().setColor(0x95a5a6).setTitle('📌 Информация о ролях').setDescription(text).setFooter({ text: 'Список актуален на текущий момент.' });
        await sendOrUpdatePanel(channel, 'roles', embed);
        return;
    }

    if (content.trim() === '!setup-verify') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const text = process.env.VERIFY_PANEL_TEXT || 'Нажмите кнопку ниже, чтобы пройти верификацию.\nВам потребуется ваш никнейм с **agerapvp.club**.';
        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('🔐 Верификация').setDescription(text);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_button').setLabel('✅ Верифицироваться').setStyle(ButtonStyle.Success));
        await sendOrUpdatePanel(channel, 'verify', embed, [row]);
        return;
    }

    // === НОВАЯ КОМАНДА ДЛЯ ТУРНИРА ===
    if (content.trim() === '!setup-tournament') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const text = process.env.TOURNAMENT_INFO_TEXT || defaultTournamentText;
        const embed = new EmbedBuilder()
            .setColor(0xe91e63)
            .setTitle('🏆 Турнир по BedWars Doubles')
            .setDescription(text)
            .setFooter({ text: 'Удачи всем участникам!' });
        await sendOrUpdatePanel(channel, 'tournament', embed);
        return;
    }

    // Остальные команды
    if (content.trim() === '!setup-info') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const embed = new EmbedBuilder().setColor(0x3498db).setTitle('📋 Инструкция').setDescription('`!verify ник` или кнопка.');
        await sendOrUpdatePanel(channel, 'info', embed);
        return;
    }
    if (content.trim() === '!setup-leaderboards') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        if (leaderboardMessageId && leaderboardChannelId === channel.id) { try { await (await channel.messages.fetch(leaderboardMessageId)).delete(); } catch (e) {} }
        try {
            const topData = await fetchTop(GAME_MODE, currentField);
            const msg = await channel.send({ embeds: [formatTopEmbed(GAME_MODE, currentField, topData)], components: [buildSelectMenu()] });
            leaderboardMessageId = msg.id; leaderboardChannelId = channel.id; startLeaderboardInterval();
        } catch (err) { channel.send('❌ Ошибка лидерборда.'); }
        return;
    }
    if (content.trim().startsWith('!setup-tickets')) {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const args = content.trim().split(/ +/); const type = args[1]?.toLowerCase();
        const valid = ['helper', 'idea', 'partner'];
        let types = type && valid.includes(type) ? [type] : valid;
        const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle('🎫 Тикеты').setDescription('Выберите тип:');
        const row = new ActionRowBuilder();
        if (types.includes('helper')) row.addComponents(new ButtonBuilder().setCustomId('ticket_helper').setLabel('Хелпер').setStyle(ButtonStyle.Primary));
        if (types.includes('idea')) row.addComponents(new ButtonBuilder().setCustomId('ticket_idea').setLabel('Идея').setStyle(ButtonStyle.Success));
        if (types.includes('partner')) row.addComponents(new ButtonBuilder().setCustomId('ticket_partner').setLabel('Партнёрство').setStyle(ButtonStyle.Secondary));
        await sendOrUpdatePanel(channel, 'tickets', embed, [row]);
        return;
    }
    if (content.trim() === '!close') {
        if (!channel.name.startsWith('helper-') && !channel.name.startsWith('idea-') && !channel.name.startsWith('partner-')) return;
        if (!member.permissions.has(PermissionFlagsBits.ManageChannels) && !member.roles.cache.has(STAFF_ROLE_ID)) return message.reply({ content: '❌ Нет прав.', flags: 64 });
        await channel.send('🔒 Закрытие...');
        setTimeout(async () => {
            if (TICKET_ARCHIVE_ID) {
                const archive = await guild.channels.fetch(TICKET_ARCHIVE_ID);
                if (archive?.type === ChannelType.GuildCategory) { await channel.setParent(TICKET_ARCHIVE_ID); await channel.send('📦 Архив.'); }
            } else await channel.delete();
        }, 2000);
        return;
    }
    if (channel.name === 'verification' && content.startsWith('!verify')) {
        const args = content.trim().split(/ +/);
        if (args.length < 2) { const m = await channel.send('❌ `!verify ник`'); setTimeout(() => { safeDelete(m); safeDelete(message); }, 5000); return; }
        const nickname = args.slice(1).join(' ');
        try {
            const statsRes = await axios.get(buildStatsUrl(nickname), { headers: { 'X-Api-Key': AGERA_API_KEY }, timeout: 5000 });
            const values = statsRes.data?.values;
            if (!values) throw new Error('Нет values');
            const experience = parseInt(values.experience), wins = parseInt(values.wins) || 0;
            if (isNaN(experience)) throw new Error('Нет опыта');
            const level = Math.floor(experience / LEVEL_EXP_DIVIDER);
            let displayName = nickname;
            try {
                const profileRes = await axios.get(buildProfileUrl(nickname), { headers: { 'X-Api-Key': AGERA_API_KEY }, timeout: 5000 });
                if (profileRes.data?.[PROFILE_NAME_FIELD]) displayName = cleanMinecraftName(profileRes.data[PROFILE_NAME_FIELD]);
            } catch (e) {}
            await updateAchievementRoles(member, wins);
            try { await member.roles.add(await guild.roles.fetch(VERIFIED_ROLE_ID)); } catch (e) {}
            try { await member.setNickname(`[${level}] ${displayName}`); } catch (e) { if (e.code !== 50013) console.error('Ник:', e); }
            setTimeout(() => safeDelete(message), 1000);
            const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Верификация').setDescription(`**${displayName}**\nУровень: **${level}**\nПобед: **${wins}**`).setTimestamp();
            const m = await channel.send({ embeds: [embed] }); setTimeout(() => safeDelete(m), 5000);
        } catch (err) {
            if (err.response?.status === 404) { const m = await channel.send(`❌ Игрок **${nickname}** не найден.`); setTimeout(() => { safeDelete(m); safeDelete(message); }, 5000); }
            else { const m = await channel.send('❌ Ошибка.'); setTimeout(() => { safeDelete(m); safeDelete(message); }, 5000); }
        }
    }
});

// ---------- Интерактивы ----------
client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'leaderboard_select') {
        const field = interaction.values[0]; currentField = field; await interaction.deferUpdate();
        try { const td = await fetchTop(GAME_MODE, field); await interaction.editReply({ embeds: [formatTopEmbed(GAME_MODE, field, td)], components: [buildSelectMenu()] }); } catch (e) {}
    }
    if (interaction.isButton() && interaction.customId === 'verify_button') {
        const modal = new ModalBuilder().setCustomId('verify_modal').setTitle('Верификация');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nickname_input').setLabel('Никнейм').setStyle(TextInputStyle.Short).setPlaceholder('IceF4ry_').setRequired(true)));
        await interaction.showModal(modal);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const nick = interaction.fields.getTextInputValue('nickname_input').trim();
        if (!nick) return interaction.reply({ content: '❌ Пустой ник.', flags: 64 });
        await handleVerification(interaction, nick);
    }
    if (interaction.isButton()) {
        const cid = interaction.customId;
        if (cid === 'ticket_helper') await createTicket(interaction, 'helper');
        else if (cid === 'ticket_idea') await createTicket(interaction, 'idea');
        else if (cid === 'ticket_partner') await createTicket(interaction, 'partner');
        else if (cid.startsWith('close_ticket_')) {
            const chId = cid.replace('close_ticket_', '');
            const tCh = interaction.guild.channels.cache.get(chId);
            if (!tCh) return interaction.reply({ content: '❌ Канал не найден.', flags: 64 });
            const mem = interaction.member;
            const ok = tCh.permissionOverwrites.cache.has(mem.user.id) || (STAFF_ROLE_ID && mem.roles.cache.has(STAFF_ROLE_ID)) || mem.permissions.has(PermissionFlagsBits.ManageChannels);
            if (!ok) return interaction.reply({ content: '❌ Нет прав.', flags: 64 });
            await interaction.deferReply({ flags: 64 });
            try {
                await tCh.send('🔒 Закрытие...');
                setTimeout(async () => {
                    if (TICKET_ARCHIVE_ID) {
                        const arch = await interaction.guild.channels.fetch(TICKET_ARCHIVE_ID);
                        if (arch?.type === ChannelType.GuildCategory) { await tCh.setParent(TICKET_ARCHIVE_ID); await tCh.send('📦 Архив.'); }
                    } else await tCh.delete();
                    await interaction.editReply({ content: '✅ Тикет закрыт.' });
                }, 2000);
            } catch (e) { await interaction.editReply({ content: '❌ Ошибка.' }); }
        }
    }
});

// ---------- Запуск ----------
client.login(DISCORD_TOKEN).catch(err => { console.error('❌', err); process.exit(1); });