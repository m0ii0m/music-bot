import {
  ActionRowBuilder,
  type ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { LavalinkManager, Player, Track } from "lavalink-client";
import { getPlayerForMember } from "./commands/guards.js";
import { formatDuration } from "./utils/format.js";
import { playPrevious, skipTrack } from "./utils/playback.js";

/** How often the progress bar is redrawn. Message edits are rate limited, so keep this to several seconds. */
const REFRESH_MS = 10_000;
const BAR_LENGTH = 18;
/**
 * Delay before moving the panel under a command's reply. A /play that starts a track posts a new panel
 * a moment later anyway, and several commands in a row only move it once.
 */
const BUMP_DELAY_MS = 1_500;
const BUTTON_PREFIX = "player:";
const BUTTONS = {
  previous: `${BUTTON_PREFIX}previous`,
  toggle: `${BUTTON_PREFIX}toggle`,
  next: `${BUTTON_PREFIX}next`,
} as const;
// Discord error code for a message that no longer exists (deleted by someone).
const UNKNOWN_MESSAGE = 10008;

/** The "Now playing" message of a guild. Discord calls run one after the other through `chain`. */
interface Panel {
  channel: SendableChannels;
  message: Message | null;
  /** Local time at which the current message was posted. */
  postedAt: number;
  timer: NodeJS.Timeout;
  bumpTimer: NodeJS.Timeout | undefined;
  chain: Promise<void>;
  refreshQueued: boolean;
}

const panels = new Map<string, Panel>();

function enqueue(panel: Panel, operation: () => Promise<unknown>) {
  panel.chain = panel.chain.then(operation).then(
    () => {},
    (error) => {
      if ((error as { code?: unknown }).code === UNKNOWN_MESSAGE) panel.message = null;
      else console.error("Failed to update the now playing message:", error);
    },
  );
}

/** Sends the panel and keeps it in sync with the player. */
export function setupNowPlaying(client: Client, lavalink: LavalinkManager) {
  lavalink.on("trackStart", (player, track) => {
    if (!track) return;
    // lavalink-client keeps the old track's position until Lavalink's next update (every few seconds).
    player.lastPosition = 0;
    player.lastPositionChange = Date.now();
    // A looped track starts again after each play: keep its panel rather than posting a new one.
    const looped = player.repeatMode === "track" && player.queue.previous[0]?.encoded === track.encoded;
    if (looped && panels.has(player.guildId)) refreshPanel(player);
    else showPanel(client, lavalink, player);
  });

  // pause, resume, seek, setRepeatMode... whether from a button or a command.
  lavalink.on("playerClientUpdate", (_oldPlayer, player) => refreshPanel(player));
  lavalink.on("queueEnd", (player) => closePanel(player.guildId, "The queue is finished."));
  lavalink.on("playerDestroy", (player) => closePanel(player.guildId, "Playback stopped."));
}

function showPanel(client: Client, lavalink: LavalinkManager, player: Player) {
  const channel = player.textChannelId ? client.channels.cache.get(player.textChannelId) : undefined;
  if (!channel?.isSendable()) return;

  let panel = panels.get(player.guildId);
  if (panel && panel.channel.id !== channel.id) {
    // The player now answers in another channel: close the old panel and start over there.
    closePanel(player.guildId, "Moved to another channel.");
    panel = undefined;
  }
  if (!panel) {
    const guildId = player.guildId;
    panel = {
      channel,
      message: null,
      postedAt: 0,
      bumpTimer: undefined,
      timer: setInterval(() => {
        const current = lavalink.getPlayer(guildId);
        // The position does not move while paused, nothing to redraw.
        if (current && !current.paused) refreshPanel(current);
      }, REFRESH_MS),
      chain: Promise.resolve(),
      refreshQueued: false,
    };
    panels.set(guildId, panel);
  }

  // Post a new message for each track so the panel stays at the bottom of the channel.
  const target = panel;
  enqueue(target, () => repost(target, player));
}

/** Moves the panel under the message just posted in its channel (a public command reply). */
export function bumpPanel(player: Player, channelId: string) {
  const panel = panels.get(player.guildId);
  if (!panel || panel.channel.id !== channelId) return;
  const requestedAt = Date.now();
  clearTimeout(panel.bumpTimer);
  panel.bumpTimer = setTimeout(() => {
    enqueue(panel, async () => {
      // Closed meanwhile, or already reposted after the reply (a new track started).
      if (panels.get(player.guildId) !== panel || panel.postedAt > requestedAt) return;
      await repost(panel, player);
    });
  }, BUMP_DELAY_MS);
}

async function repost(panel: Panel, player: Player) {
  const old = panel.message;
  panel.message = null;
  await old?.delete().catch(() => {});
  if (!player.queue.current) return;
  panel.message = await panel.channel.send(renderPanel(player));
  panel.postedAt = Date.now();
}

function refreshPanel(player: Player) {
  const panel = panels.get(player.guildId);
  // Coalesce bursts of updates into a single edit.
  if (!panel || panel.refreshQueued) return;
  panel.refreshQueued = true;
  enqueue(panel, async () => {
    panel.refreshQueued = false;
    if (!panel.message || !player.queue.current) return;
    await panel.message.edit(renderPanel(player));
  });
}

function closePanel(guildId: string, text: string) {
  const panel = panels.get(guildId);
  if (!panel) return;
  clearInterval(panel.timer);
  clearTimeout(panel.bumpTimer);
  panels.delete(guildId);
  enqueue(panel, async () => {
    if (!panel.message) return;
    const embed = EmbedBuilder.from(panel.message.embeds[0] ?? {})
      .setColor(0x4f545c)
      .setAuthor({ name: "Finished" })
      .setDescription(text)
      .setFields()
      .setFooter(null);
    await panel.message.edit({ embeds: [embed], components: [] });
  });
}

function renderPanel(player: Player) {
  const track = player.queue.current!;
  const { info } = track;

  const progress = info.isStream
    ? "🔴 LIVE"
    : `\`${formatDuration(Math.min(player.position, info.duration))}\` ${progressBar(player.position, info.duration)} \`${formatDuration(info.duration)}\``;

  const embed = new EmbedBuilder()
    .setColor(player.paused ? 0xfaa61a : 0x5865f2)
    .setAuthor({ name: player.paused ? "⏸ Paused" : "▶ Now playing" })
    .setTitle(truncate(info.title, 256))
    .setDescription(`${info.author}\n\n${progress}`)
    .setThumbnail(info.artworkUrl ?? null);
  if (info.uri) embed.setURL(info.uri);

  const next = player.queue.tracks[0];
  if (next) embed.addFields({ name: "Up next", value: truncate(`${next.info.title} — ${next.info.author}`, 1024) });

  const footer = [`${player.queue.tracks.length} in queue`];
  if (player.repeatMode !== "off") footer.push(`Loop: ${player.repeatMode === "track" ? "track" : "queue"}`);
  const requester = requesterName(track);
  if (requester) footer.push(`Requested by ${requester}`);
  embed.setFooter({ text: footer.join(" · ") });

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BUTTONS.previous).setEmoji("⏮️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(BUTTONS.toggle)
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BUTTONS.next).setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [buttons] };
}

function progressBar(position: number, duration: number): string {
  const ratio = duration > 0 ? Math.min(Math.max(position / duration, 0), 1) : 0;
  const filled = Math.round(ratio * (BAR_LENGTH - 1));
  return `${"━".repeat(filled)}●${"─".repeat(BAR_LENGTH - 1 - filled)}`;
}

function requesterName(track: Track): string | null {
  const requester = track.requester as { displayName?: unknown; username?: unknown } | undefined;
  const name = requester?.displayName ?? requester?.username;
  return typeof name === "string" ? name : null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function isPlayerButton(customId: string): boolean {
  return customId.startsWith(BUTTON_PREFIX);
}

export async function handlePlayerButton(interaction: ButtonInteraction<"cached">, lavalink: LavalinkManager) {
  const player = await getPlayerForMember(interaction, lavalink);
  if (!player) return;
  // Acknowledge without a reply: the panel itself shows the result.
  await interaction.deferUpdate();

  switch (interaction.customId) {
    case BUTTONS.toggle:
      if (player.paused) await player.resume();
      else await player.pause();
      break;
    case BUTTONS.next:
      await skipTrack(player);
      break;
    case BUTTONS.previous:
      await playPrevious(player);
      break;
  }
}
