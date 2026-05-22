// index.js
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');

// ---------- Переменные окружения ----------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const AGERA_API_KEY = process.env.AGERA_API_KEY;
const AGERA_API_BASE_URL = process.env.AGERA_API_BASE_URL || 'https://api.agerapvp.club';

// Режим игры (по умолчанию BedWars)
const GAME_MODE = process.env.GAME_MODE || 'BW';

// Поля в ответе API для верификации
const BW_LEVEL_FIELD = process.env.BW_LEVEL_FIELD || 'bw_level';
const BW_WINS_FIELD  = process.env.BW_WINS_FIELD  || 'bw_wins';

// Настройки лидерборда
const LEADERBOARD_INTERVAL_MIN = parseInt(process.env.LEADERBOARD_UPDATE_INTERVAL_MIN) || 30;

// ---------- Формирование URL запросов ----------
const buildStatsUrl = (nickname) => {
    const encodedNick = encodeURIComponent(nickname);
    return `${AGERA_API_BASE_URL}/v1/player/stats/${encodedNick}/${GAME_MODE}`;
};

const buildTopUrl = (mode, field) => {
    return `${AGERA_API_BASE_URL}/v1/core/top/${encodeURIComponent(mode)}/${encodeURIComponent(field)}`;
};

// ---------- Проверка обязательных переменных ----------
if (!DISCORD_TOKEN) {
    console.error('❌ Отсутствует DISCORD_TOKEN в переменных окружения.');
    process.exit(1);
}
if (!VERIFIED_ROLE_ID) {
    console.error('❌ Отсутствует VERIFIED_ROLE_ID в переменных окружения.');
    process.exit(1);
}
if (!AGERA_API_KEY) {
    console.warn('⚠️ AGERA_API_KEY не задан – запросы к API могут не работать.');
}

// ---------- Создание клиента ----------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// ---------- Вспомогательные функции ----------
async function safeDelete(message, timeout = 0) {
    if (timeout > 0) await new Promise(resolve => setTimeout(resolve, timeout));
    try {
        await message.delete();
    } catch (err) {
        if (err.code !== 10008) console.error('Не удалось удалить сообщение:', err.message);
    }
}

// ---------- Функции лидерборда ----------
let leaderboardMessageId = null;
let leaderboardChannelId = null;
let leaderboardInterval = null;

async function fetchTop(mode, field) {
    const response = await axios.get(buildTopUrl(mode, field), {
        headers: { Authorization: `Bearer ${AGERA_API_KEY}` },
        timeout: 5000,
    });
    return response.data;
}

function formatTopEmbed(mode, field, data) {
    const top = data.top;
    if (!top || Object.keys(top).length === 0) {
        return new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle(`📊 Топ ${mode} – ${field}`)
            .setDescription('Нет данных для отображения.')
            .setTimestamp();
    }

    const sorted = Object.entries(top)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const description = sorted
        .map(([player, value], index) => `**${index + 1}.** ${player} — \`${value}\``)
        .join('\n');

    return new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`📊 Топ ${mode} – ${field}`)
        .setDescription(description)
        .setFooter({ text: `Обновлено • Обновляется каждые ${LEADERBOARD_INTERVAL_MIN} мин.` })
        .setTimestamp();
}

async function refreshLeaderboard() {
    if (!leaderboardChannelId || !leaderboardMessageId) return;

    try {
        const channel = await client.channels.fetch(leaderboardChannelId);
        if (!channel) return;

        const message = await channel.messages.fetch(leaderboardMessageId);
        if (!message) return;

        const field = message.embeds[0]?.title?.split(' – ')[1]; // извлекаем field из заголовка
        if (!field) return;

        const topData = await fetchTop(GAME_MODE, field);
        const embed = formatTopEmbed(GAME_MODE, field, topData);
        await message.edit({ embeds: [embed] });
    } catch (err) {
        console.error('Ошибка обновления лидерборда:', err.message);
    }
}

function startLeaderboardInterval() {
    if (leaderboardInterval) clearInterval(leaderboardInterval);
    if (!leaderboardChannelId || !leaderboardMessageId) return;

    leaderboardInterval = setInterval(refreshLeaderboard, LEADERBOARD_INTERVAL_MIN * 60 * 1000);
    console.log(`🔄 Лидерборд будет обновляться каждые ${LEADERBOARD_INTERVAL_MIN} мин.`);
}

// ---------- Готовность бота ----------
client.once('ready', () => {
    console.log(`✅ Бот ${client.user.tag} запущен.`);
    // Если бот перезапущен, интервал не восстанавливается автоматически (нужен повторный !setup-leaderboard)
});

// ---------- Обработка сообщений ----------
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const { content, channel, member } = message;

    // ---- !setup-info (для администраторов) ----
    if (content.trim() === '!setup-info') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;

        const infoEmbed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('📋 Инструкция по верификации')
            .setDescription(
                '**Здравствуйте!** Для того чтобы зарегистрироваться на нашем сервере, ' +
                'напишите в этот канал команду:\n' +
                '`!verify ВашНикнейм`\n\n' +
                'Пример: `!verify Player123`\n\n' +
                'Бот проверит ваш аккаунт на сервере **agerapvp.club**, ' +
                'выдаст роль «Верифицирован» и установит ваш ник в формате `[Уровень] Ник`.'
            )
            .setFooter({ text: 'Убедитесь, что ваш ник в игре указан верно!' });
        await channel.send({ embeds: [infoEmbed] });
        return;
    }

    // ---- !setup-leaderboard <field> ----
    if (content.startsWith('!setup-leaderboard')) {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;

        const args = content.trim().split(/ +/);
        if (args.length < 2) {
            await channel.send('❌ Укажите поле статистики, например: `!setup-leaderboard wins`');
            return;
        }
        const field = args[1].toLowerCase();
        // Допустимые поля: wins, kills, bw_level, beds_broken и т.д. – уточните по документации
        // Здесь не делаем жёсткую проверку, просто пробуем запросить.

        // Если уже есть лидерборд в этом канале – удалим старое сообщение (опционально)
        if (leaderboardMessageId && leaderboardChannelId === channel.id) {
            try {
                const oldMsg = await channel.messages.fetch(leaderboardMessageId);
                await oldMsg.delete();
            } catch (e) { /* игнорируем */ }
        }

        try {
            const topData = await fetchTop(GAME_MODE, field);
            const embed = formatTopEmbed(GAME_MODE, field, topData);
            const leaderMsg = await channel.send({ embeds: [embed] });

            // Сохраняем новые ID
            leaderboardMessageId = leaderMsg.id;
            leaderboardChannelId = channel.id;

            // Запускаем/перезапускаем интервал обновления
            startLeaderboardInterval();

            console.log(`📊 Лидерборд "${field}" создан в канале #${channel.name}`);
        } catch (err) {
            console.error('Ошибка создания лидерборда:', err);
            channel.send('❌ Не удалось получить данные для лидерборда. Проверьте правильность поля и доступность API.');
        }
        return;
    }

    // ---- Остальной код только для канала "verification" ----
    if (channel.name !== 'verification') return;

    // ---- !verify [ник] ----
    if (!content.startsWith('!verify')) return;

    const argsVerify = content.trim().split(/ +/);
    if (argsVerify.length < 2) {
        const errorMsg = await channel.send('❌ Ошибка! Напишите команду в формате: `!verify ваш_ник`');
        setTimeout(() => {
            safeDelete(errorMsg);
            safeDelete(message);
        }, 5000);
        return;
    }

    const nickname = argsVerify.slice(1).join(' ');

    try {
        const response = await axios.get(buildStatsUrl(nickname), {
            headers: { Authorization: `Bearer ${AGERA_API_KEY}` },
            timeout: 5000,
        });

        const values = response.data?.values;
        if (!values) throw new Error('Неожиданный формат ответа API (отсутствует values).');

        const bw_level = values[BW_LEVEL_FIELD];
        const bw_wins  = values[BW_WINS_FIELD];

        if (bw_level === undefined || bw_wins === undefined) {
            console.error('❌ Ответ API не содержит ожидаемых полей:', values);
            const errMsg = await channel.send(
                `❌ Не удалось получить данные игрока. Проверьте настройки полей (BW_LEVEL_FIELD, BW_WINS_FIELD) в переменных окружения.`
            );
            setTimeout(() => {
                safeDelete(errMsg);
                safeDelete(message);
            }, 5000);
            return;
        }

        // Выдача роли
        try {
            const role = await message.guild.roles.fetch(VERIFIED_ROLE_ID);
            if (!role) {
                const errMsg = await channel.send('❌ Роль верификации не найдена. Обратитесь к администратору.');
                setTimeout(() => safeDelete(errMsg), 5000);
                return;
            }
            await member.roles.add(role);
        } catch (roleError) {
            console.error('Ошибка выдачи роли:', roleError);
            channel.send('⚠️ Не удалось выдать роль, но я продолжу верификацию.')
                .then(m => setTimeout(() => safeDelete(m), 5000));
        }

        // Смена никнейма
        try {
            await member.setNickname(`[${bw_level}] ${nickname}`);
        } catch (nickError) {
            if (nickError.code === 50013) {
                console.warn(`⚠️ Нет прав сменить ник для ${nickname} (роль выше).`);
            } else {
                console.error('Ошибка смены ника:', nickError);
            }
        }

        setTimeout(() => safeDelete(message), 1000);

        const successEmbed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('✅ Успешная верификация!')
            .setDescription(
                `Добро пожаловать, **${nickname}**!\n` +
                `Ваш уровень BedWars: **${bw_level}**\n` +
                `Количество побед: **${bw_wins}**`
            )
            .setFooter({ text: 'Приятной игры на сервере!' })
            .setTimestamp();

        const successMsg = await channel.send({ embeds: [successEmbed] });
        setTimeout(() => safeDelete(successMsg), 5000);

    } catch (apiError) {
        if (apiError.response) {
            if (apiError.response.status === 404) {
                const notFoundMsg = await channel.send(
                    `❌ Игрок с ником **${nickname}** не найден на сервере agerapvp.club. Проверьте правильность написания!`
                );
                setTimeout(() => {
                    safeDelete(notFoundMsg);
                    safeDelete(message);
                }, 5000);
            } else {
                console.error(`API ответил статусом ${apiError.response.status}:`, apiError.response.data);
                const errMsg = await channel.send('❌ Ошибка сервера. Попробуйте позже.');
                setTimeout(() => {
                    safeDelete(errMsg);
                    safeDelete(message);
                }, 5000);
            }
        } else if (apiError.code === 'ECONNABORTED') {
            console.error('Таймаут запроса к API.');
            const timeoutMsg = await channel.send('❌ Сервер не отвечает. Повторите попытку позже.');
            setTimeout(() => {
                safeDelete(timeoutMsg);
                safeDelete(message);
            }, 5000);
        } else {
            console.error('Неизвестная ошибка:', apiError.message);
            const genErrMsg = await channel.send('❌ Произошла непредвиденная ошибка.');
            setTimeout(() => {
                safeDelete(genErrMsg);
                safeDelete(message);
            }, 5000);
        }
    }
});

// ---------- Запуск ----------
client.login(DISCORD_TOKEN).catch(err => {
    console.error('❌ Не удалось войти в Discord:', err);
    process.exit(1);
});
