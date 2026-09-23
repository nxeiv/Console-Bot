'use strict';

const {
  ActivityType,
  Client,
  Colors,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const config = require('./config');
const mc = require('./minecraft');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Starts AFK Session'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stops AFK Session'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Shows AFK Status'),
].map(command => command.toJSON());

function log(tag, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [${tag}] ${message}`);
}

function formatUptime(totalSeconds) {
  if (!totalSeconds) return '0s';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    `${seconds}s`,
  ].filter(Boolean).join(' ');
}

function formatDelay(delayMs) {
  const seconds = Math.round(delayMs / 1000);

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${seconds} seconds`;
}

function getBotState(status) {
  if (status.connected) return 'Online';
  if (status.connecting || status.reconnecting) return 'Reconnecting';
  return 'Offline';
}

function createEmbed(title, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setFooter({ text: 'By Makkrabb' })
    .setTimestamp();
}

function buildStatusEmbed(status, title, color) {
  return createEmbed(title, color)
    .addFields(
      {
        name: 'Server',
        value: `\`${status.server}\``,
        inline: true,
      },
      {
        name: 'Bot Status',
        value: getBotState(status),
        inline: true,
      },
      {
        name: 'Players Online',
        value: String(status.playerCount),
        inline: true,
      },
      {
        name: 'Uptime',
        value: status.connected
          ? formatUptime(status.uptime)
          : 'Not connected',
        inline: true,
      },
      {
        name: 'Reconnect Attempts',
        value: String(status.reconnectAttempts),
        inline: true,
      },
      {
        name: 'Bot Name',
        value: `\`${config.bot.username}\``,
        inline: true,
      },
    );
}

function shorten(text, limit = 1000) {
  const normalized = String(text || 'Unknown reason')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > limit
    ? `${normalized.slice(0, limit - 3)}...`
    : normalized;
}

async function registerCommands() {
  const rest = new REST({ version: '10' })
    .setToken(config.discord.token);

  const route = Routes.applicationGuildCommands(
    config.discord.clientId,
    config.discord.guildId,
  );

  try {
    log('Discord', 'Checking existing slash commands...');

    const existing = await rest.get(route);

    log(
      'Discord',
      `Discord currently reports ${existing.length} guild command(s).`,
    );

    for (const command of existing) {
      log(
        'Discord',
        `Existing command: /${command.name} (${command.id})`,
      );
    }

    log('Discord', 'Registering slash commands...');

    const registered = await rest.put(route, {
      body: commands,
    });

    log(
      'Discord',
      `Slash commands registered successfully: ${registered.length} command(s).`,
    );

    for (const command of registered) {
      log(
        'Discord',
        `Registered command: /${command.name} (${command.id})`,
      );
    }
  } catch (error) {
    log(
      'Discord',
      `Unable to register slash commands: ${error.message}`,
    );
  }
}

let commandWatchdogRunning = false;

async function commandWatchdog() {
  if (commandWatchdogRunning) return;

  commandWatchdogRunning = true;

  try {
    const rest = new REST({ version: '10' })
      .setToken(config.discord.token);

    const route = Routes.applicationGuildCommands(
      config.discord.clientId,
      config.discord.guildId,
    );

    const existing = await rest.get(route);

    const existingNames = new Set(
      existing.map(command => command.name),
    );

    const expectedNames = new Set(
      commands.map(command => command.name),
    );

    const missing = commands.filter(
      command => !existingNames.has(command.name),
    );

    const unexpected = existing.filter(
      command => !expectedNames.has(command.name),
    );

    if (missing.length === 0 && unexpected.length === 0) {
      log(
        'Watchdog',
        `Slash commands OK (${existing.length}/${commands.length}).`,
      );
      return;
    }

    if (missing.length > 0) {
      log(
        'Watchdog',
        `Missing commands detected: ${missing
          .map(command => `/${command.name}`)
          .join(', ')}`,
      );
    }

    if (unexpected.length > 0) {
      log(
        'Watchdog',
        `Unexpected commands detected: ${unexpected
          .map(command => `/${command.name}`)
          .join(', ')}`,
      );
    }

    await rest.put(route, {
      body: commands,
    });

    log(
      'Watchdog',
      `Slash commands repaired successfully (${commands.length} command(s)).`,
    );
  } catch (error) {
    log(
      'Watchdog',
      `Command check failed: ${error.message}`,
    );
  } finally {
    commandWatchdogRunning = false;
  }
}

async function notifyChannel(embed) {
  if (!config.discord.statusChannelId) return;

  try {
    const channel = await client.channels.fetch(
      config.discord.statusChannelId,
    );

    if (!channel?.isTextBased()) {
      log(
        'Discord',
        'The configured status channel is not a text channel.',
      );
      return;
    }

    await channel.send({
      embeds: [embed],
    });
  } catch (error) {
    log(
      'Discord',
      `Unable to send a status update: ${error.message}`,
    );
  }
}

function updatePresence() {
  if (!client.user) return;

  const status = mc.getStatus();
  const reconnecting = status.connecting || status.reconnecting;

  const presence = status.connected
    ? {
        status: 'online',
        activities: [{
          name: 'Minecraft: The Cottage★ SMP★',
          type: ActivityType.Playing,
        }],
      }
    : reconnecting
      ? {
          status: 'idle',
          activities: [{
            name: 'Watching #minecraft-server⛏️',
            type: ActivityType.Watching,
          }],
        }
      : {
          status: 'dnd',
          activities: [{
            name: 'Offline - use /start',
            type: ActivityType.Watching,
          }],
        };

  client.user.setPresence(presence);
}

mc.emitter.on('connected', ({ version }) => {
  updatePresence();

  const status = mc.getStatus();

  const embed = buildStatusEmbed(
    status,
    'Bot Connected',
    Colors.Green,
  ).setDescription(
    `Connected to ${status.server} using Minecraft ${version}.`,
  );

  void notifyChannel(embed);
});

mc.emitter.on('kicked', reason => {
  updatePresence();

  const embed = createEmbed(
    'Bot Kicked',
    Colors.Orange,
  ).setDescription(
    `Reason: ${shorten(reason)}`,
  );

  void notifyChannel(embed);
});

mc.emitter.on('disconnected', () => {
  updatePresence();
});

mc.emitter.on('reconnecting', ({ attempt, delayMs }) => {
  updatePresence();

  const delay = formatDelay(delayMs);

  log(
    'Bot',
    `Reconnect attempt ${attempt} is scheduled in ${delay}.`,
  );

  const embed = createEmbed(
    'Reconnection Scheduled',
    Colors.Orange,
  ).setDescription(
    `Attempt ${attempt} will begin in ${delay}.`,
  );

  void notifyChannel(embed);
});

mc.emitter.on('stopped', () => {
  updatePresence();

  const embed = createEmbed(
    'Bot Stopped',
    Colors.Red,
  ).setDescription(
    'The AFK session was stopped. Use /start to connect again.',
  );

  void notifyChannel(embed);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;

  log(
    'Discord',
    `/${commandName} requested by ${interaction.user.tag}.`,
  );

  // Acknowledge immediately so Discord does not expire the interaction
  // while the command is being processed.
  try {
    await interaction.deferReply();
  } catch (error) {
    log(
      'Discord',
      `Unable to acknowledge /${commandName}: ${error.message}`,
    );
    return;
  }

  try {
    const status = mc.getStatus();

    switch (commandName) {
      case 'start': {
        if (
          status.connected ||
          status.connecting ||
          status.reconnecting
        ) {
          return interaction.editReply({
            embeds: [
              createEmbed(
                'Bot Already Active',
                Colors.Yellow,
              ).setDescription(
                'The bot is already connected or waiting to reconnect.',
              ),
            ],
          });
        }

        mc.start();

        return interaction.editReply({
          embeds: [
            createEmbed(
              'Joining Server',
              Colors.Green,
            ).setDescription(
              `Connecting to ${config.server.ip}. The server may take up to two minutes to wake.`,
            ).addFields(
              {
                name: 'Bot Name',
                value: `\`${config.bot.username}\`\`,
                inline: true,
              },
              {
                name: 'Server',
                value: `\`${config.server.ip}\`\`,
                inline: true,
              },
            ),
          ],
        });
      }

      case 'stop': {
        if (
          !status.connected &&
          !status.connecting &&
          !status.reconnecting
        ) {
          return interaction.editReply({
            embeds: [
              createEmbed(
                'Bot Already Offline',
                Colors.Blurple,
              ).setDescription(
                'There is no active AFK session to stop.',
              ),
            ],
          });
        }

        mc.stop();

        return interaction.editReply({
          embeds: [
            createEmbed(
              'Bot Stopped',
              Colors.Red,
            ).setDescription(
              'The AFK session was stopped. Use /start to connect again.',
            ),
          ],
        });
      }

      case 'status': {
        const color = status.connected
          ? Colors.Green
          : (
              status.connecting || status.reconnecting
                ? Colors.Yellow
                : Colors.DarkGrey
            );

        return interaction.editReply({
          embeds: [
            buildStatusEmbed(
              status,
              `Bot Status: ${getBotState(status)}`,
              color,
            ),
          ],
        });
      }

      default:
        return interaction.editReply({
          content: 'Unknown command.',
        });
    }
  } catch (error) {
    log(
      'Discord',
      `Error handling /${commandName}: ${error.stack || error.message}`,
    );

    try {
      await interaction.editReply({
        content: '⚠️ The command could not be completed. Check the Console Bot logs.',
      });
    } catch (replyError) {
      log(
        'Discord',
        `Unable to send command error response: ${replyError.message}`,
      );
    }
  }
});

client.once(Events.ClientReady, async readyClient => {
  log(
    'Discord',
    `Logged in as ${readyClient.user.tag}.`,
  );

  await registerCommands();

  // Slash command watchdog: check every 5 minutes.
  log(
    'Watchdog',
    'Slash command watchdog started (every 5 minutes).',
  );

  setInterval(() => {
    void commandWatchdog();
  }, 5 * 60 * 1000);

  updatePresence();

  log('Bot', 'Starting AFK session.');

  mc.start();
});

process.on('uncaughtException', error => {
  console.error(
    '[Fatal] Uncaught exception:',
    error.stack || error.message,
  );
});

process.on('unhandledRejection', reason => {
  console.error(
    '[Fatal] Unhandled rejection:',
    reason,
  );
});

log('Discord', 'Starting Discord bot.');

client.login(config.discord.token);