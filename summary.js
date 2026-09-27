
'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const { generateText } = require('./ai');

const MAX_MESSAGES = 100;
const MAX_SOURCE_CHARS = 45000;
const DISMISS_PREFIX = 'summary:dismiss:';

function cleanText(value) {
  return String(value || '')
    .replace(/<@!?[0-9]+>/g, '@user')
    .replace(/<@&[0-9]+>/g, '@role')
    .replace(/<#[0-9]+>/g, '#channel')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveChannel(message, request) {
  const mentioned = message.mentions.channels.first();
  if (mentioned?.isTextBased()) return mentioned;

  const normalized = String(request || '')
    .replace(/\b(this|that|the)\s+channel\b/gi, '')
    .replace(/\bchannel\b/gi, '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase();

  if (!normalized) return message.channel;

  return message.guild.channels.cache.find(channel =>
    channel.isTextBased() &&
    channel.name?.toLowerCase() === normalized
  ) || null;
}

function extractRequest(message, client) {
  let text = message.content || '';

  if (client.user) {
    text = text.replace(new RegExp('<@!?' + client.user.id + '>', 'g'), ' ');
  }

  return text
    .replace(/\bsummar(?:y|ize|ise)\b/gi, ' ')
    .replace(/\bplease\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMessages(messages) {
  const lines = [];
  let total = 0;

  for (const message of messages.reverse()) {
    const content = cleanText(message.content);
    const attachments = message.attachments.size
      ? ' [' + message.attachments.size + ' attachment(s)]'
      : '';

    if (!content && !attachments) continue;

    const line =
      '[' + message.createdAt.toISOString() + '] ' +
      (message.author?.username || 'Unknown') + ': ' +
      (content || '(no text)') + attachments;

    if (total + line.length > MAX_SOURCE_CHARS) break;
    lines.push(line);
    total += line.length;
  }

  return lines.join('\n');
}

function truncate(text, max = 3900) {
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

function components(ownerId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(DISMISS_PREFIX + ownerId)
        .setLabel('Dismiss')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function summarizeChannel({ message, client }) {
  if (!message.guild) {
    await message.reply('Summaries are only available inside a server.');
    return;
  }

  const request = extractRequest(message, client);
  const channel = resolveChannel(message, request);

  if (!channel) {
    await message.reply(
      'I could not identify that channel. Mention it with #channel-name or say this channel.'
    );
    return;
  }

  if (!channel.isTextBased() || typeof channel.messages?.fetch !== 'function') {
    await message.reply('That channel does not support message history.');
    return;
  }

  let fetched;
  try {
    fetched = await channel.messages.fetch({ limit: MAX_MESSAGES });
  } catch (error) {
    console.error('[Summary] Unable to fetch channel history:', error);
    await message.reply(
      'I cannot read that channel. Check that I can View Channel and Read Message History there.'
    );
    return;
  }

  const source = formatMessages([...fetched.values()]);

  if (!source) {
    await message.reply('There are no readable messages to summarize in that channel.');
    return;
  }

  const prompt = [
    'Summarize the recent conversation from Discord channel #' +
      (channel.name || 'unknown') + '.',
    'Use only the transcript below.',
    'Start with a short overview, then use concise bullet points.',
    'Include decisions, plans, questions, disagreements, and unresolved items when present.',
    'Do not guess or invent details.',
    '',
    'TRANSCRIPT:',
    source,
  ].join('\n');

  let result;
  try {
    result = await generateText(prompt);
  } catch (error) {
    console.error('[Summary] Gemini request failed:', error);
    await message.reply(
      'I could not generate the summary right now. The AI service may be rate-limited or temporarily unavailable.'
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Summary of #' + (channel.name || 'channel'))
    .setDescription(truncate(result))
    .setFooter({
      text: 'Requested by ' + message.author.username +
        ' • Up to ' + MAX_MESSAGES + ' recent messages',
    })
    .setTimestamp();

  return message.channel.send({
    embeds: [embed],
    components: components(message.author.id),
  });
}

async function handleSummaryButton(interaction) {
  if (
    !interaction.isButton() ||
    !interaction.customId.startsWith(DISMISS_PREFIX)
  ) return false;

  const ownerId = interaction.customId.slice(DISMISS_PREFIX.length);
  const isOwner = interaction.user.id === ownerId;
  const isModerator =
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);

  if (!isOwner && !isModerator) {
    await interaction.reply({
      content: 'Only the requester or a moderator can dismiss this summary.',
      ephemeral: true,
    });
    return true;
  }

  await interaction.update({ components: [] });
  return true;
}

module.exports = { summarizeChannel, handleSummaryButton };
