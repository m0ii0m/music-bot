import {
  ActionRowBuilder,
  AttachmentBuilder,
  type ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ContainerBuilder,
  escapeMarkdown,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  type Message,
  type MessageCreateOptions,
  MessageFlags,
  SectionBuilder,
  type SendableChannels,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import type { LavalinkManager, Player, RepeatMode, Track } from "lavalink-client";
import { getPlayerForMember } from "./commands/guards.js";
import { isAutoplayEnabled, isAutoplayTrack, setAutoplay } from "./utils/autoplay.js";
import { playPrevious, skipTrack } from "./utils/playback.js";
import { renderProgressImage } from "./utils/progressImage.js";

/** How often the progress bar is redrawn. Message edits are rate limited, so keep this to several seconds. */
const REFRESH_MS = 10_000;
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
  stop: `${BUTTON_PREFIX}stop`,
  loop: `${BUTTON_PREFIX}loop`,
  autoplay: `${BUTTON_PREFIX}autoplay`,
} as const;
const COLORS = { playing: 0x9b87f5, paused: 0xfaa61a, finished: 0x4f545c } as const;
const PROGRESS_FILE = "progress.png";
const NEXT_REPEAT_MODE: Record<RepeatMode, RepeatMode> = { off: "track", track: "queue", queue: "off" };
const REPEAT_LABELS: Record<RepeatMode, string> = { off: "Off", track: "Track", queue: "Queue" };
// Discord error code for a message that no longer exists (deleted by someone).
const UNKNOWN_MESSAGE = 10008;

/** The "Now playing" message of a guild. Discord calls run one after the other through `chain`. */
interface Panel {
  channel: SendableChannels;
  message: Message | null;
  /** Local time at which the current message was posted. */
  postedAt: number;
  /** Last track shown, kept to draw the "Finished" message once the player is gone. */
  track: Track | null;
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
      track: null,
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
  panel.track = player.queue.current;
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
    panel.track = player.queue.current;
    // The new progress image replaces the old one: discord.js only keeps the attachments listed in the edit.
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
    const container = new ContainerBuilder()
      .setAccentColor(COLORS.finished)
      .addTextDisplayComponents(heading("Finished"))
      .addSeparatorComponents(divider());
    if (panel.track) addTrackInfo(container, panel.track, [text]);
    else container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    await panel.message.edit({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      files: [],
      attachments: [],
    });
  });
}

/**
 * The panel as a Components V2 message: a container with the track, its artwork and settings,
 * the progress bar (an image redrawn on each refresh) and the playback buttons.
 */
function renderPanel(player: Player) {
  const track = player.queue.current!;
  const { info } = track;
  const accent = player.paused ? COLORS.paused : COLORS.playing;

  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(heading(player.paused ? "⏸ Paused" : "▶ Now playing"))
    .addSeparatorComponents(divider());

  const details: string[] = [];
  const requester = requesterId(track);
  if (requester) details.push(`- Added by <@${requester}>`);
  else if (isAutoplayTrack(track)) details.push("- Added by 📻 AutoPlay");
  if (player.voiceChannelId) details.push(`- 🔊 <#${player.voiceChannelId}>`);
  addTrackInfo(container, track, details);

  const settings = [
    `Queue: \`${player.queue.tracks.length}\``,
    `Volume: \`${player.volume}%\``,
    `Loop: \`${REPEAT_LABELS[player.repeatMode]}\``,
    `AutoPlay: \`${isAutoplayEnabled(player) ? "On" : "Off"}\``,
  ].join(" · ");
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(settings))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(BUTTONS.loop)
          .setEmoji(player.repeatMode === "track" ? "🔂" : "🔁")
          .setLabel("Loop")
          .setStyle(player.repeatMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ),
  );

  const files: AttachmentBuilder[] = [];
  if (info.isStream) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("🔴 **LIVE**"));
  } else {
    const image = renderProgressImage(player.position, info.duration, `#${accent.toString(16).padStart(6, "0")}`);
    files.push(new AttachmentBuilder(image, { name: PROGRESS_FILE }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${PROGRESS_FILE}`).setDescription("Progress"),
      ),
    );
  }

  const next = player.queue.tracks[0];
  if (next) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        truncate(`-# Up next: ${escapeMarkdown(next.info.title)} — ${escapeMarkdown(next.info.author ?? "")}`, 500),
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTONS.previous)
        .setEmoji("⏮️")
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTONS.toggle)
        .setEmoji(player.paused ? "▶️" : "⏸️")
        .setLabel(player.paused ? "Resume" : "Pause")
        .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BUTTONS.next).setEmoji("⏭️").setLabel("Skip").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BUTTONS.stop).setEmoji("⏹️").setLabel("Stop").setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(BUTTONS.autoplay)
        .setEmoji("📻")
        .setLabel("AutoPlay")
        .setStyle(isAutoplayEnabled(player) ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files,
    // "Added by" mentions the requester: show it without pinging them.
    allowedMentions: { parse: [] },
  } satisfies MessageCreateOptions;
}

function heading(text: string) {
  return new TextDisplayBuilder().setContent(`### ${text}`);
}

function divider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

/** Title (linked), author and extra lines, with the artwork on the right when the track has one. */
function addTrackInfo(container: ContainerBuilder, track: Track, lines: string[]) {
  const { info } = track;
  const title = escapeMarkdown(truncate(info.title, 200)).replace(/[[\]]/g, "\\$&");
  const text = new TextDisplayBuilder().setContent(
    [info.uri ? `**[${title}](${info.uri})**` : `**${title}**`, escapeMarkdown(info.author), ...lines].join("\n"),
  );
  const artwork = info.artworkUrl;
  if (!artwork) {
    container.addTextDisplayComponents(text);
    return;
  }
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(text)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(artwork)),
  );
}

function requesterId(track: Track): string | null {
  const id = (track.requester as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : null;
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
    case BUTTONS.loop:
      await player.setRepeatMode(NEXT_REPEAT_MODE[player.repeatMode]);
      break;
    case BUTTONS.autoplay:
      setAutoplay(player, !isAutoplayEnabled(player));
      // Player data is not a Lavalink update, so no playerClientUpdate redraws the panel.
      refreshPanel(player);
      break;
    case BUTTONS.stop:
      // Same as /stop: playerDestroy turns the panel into its "Finished" state.
      await player.destroy();
      break;
  }
}
