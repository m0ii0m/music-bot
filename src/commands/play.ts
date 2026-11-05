import { MessageFlags, SlashCommandBuilder, type User } from "discord.js";
import type { Player, Track, UnresolvedTrack } from "lavalink-client";
import { formatDuration } from "../utils/format.js";
import type { Command } from "./types.js";

// Loading a youtube.com URL fails ("requires login": the TV client that has OAuth only plays, it cannot load),
// while search results play fine. So the tracks offered as suggestions are kept here, keyed by the URL sent
// as the option value, and /play uses them directly instead of loading the URL.
const SUGGESTION_TTL_MS = 10 * 60_000;
const suggestions = new Map<string, { track: Track; expiresAt: number }>();

export const play: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or a playlist")
    .addStringOption((option) =>
      option.setName("query").setDescription("Search terms or a URL").setRequired(true).setAutocomplete(true),
    ),

  async autocomplete(interaction, lavalink) {
    const query = interaction.options.getFocused().trim();
    // Nothing to suggest for very short input or a pasted URL: the user submits it as is.
    if (query.length < 2 || /^https?:\/\//i.test(query) || !lavalink.useable) {
      return interaction.respond([]);
    }

    const node = lavalink.getPlayer(interaction.guildId)?.node ?? lavalink.nodeManager.leastUsedNodes()[0];
    if (!node) return interaction.respond([]);

    const result = await node.search({ query, source: "ytsearch" }, interaction.user);
    const tracks = result.tracks.filter((track) => track.info.uri && track.info.uri.length <= 100).slice(0, 10);

    const now = Date.now();
    for (const [uri, entry] of suggestions) if (entry.expiresAt <= now) suggestions.delete(uri);
    for (const track of tracks) suggestions.set(track.info.uri!, { track, expiresAt: now + SUGGESTION_TTL_MS });

    return interaction.respond(
      tracks.map((track) => ({
        name: truncate(`${track.info.title} — ${track.info.author} (${formatDuration(track.info.duration ?? 0)})`, 100),
        value: track.info.uri!,
      })),
    );
  },

  async execute(interaction, lavalink) {
    const voiceChannelId = interaction.member.voice.channelId;
    if (!voiceChannelId) {
      return interaction.reply({ content: "Join a voice channel first.", flags: MessageFlags.Ephemeral });
    }
    if (!lavalink.useable) {
      return interaction.reply({ content: "The audio server is not ready yet, try again in a moment.", flags: MessageFlags.Ephemeral });
    }

    const existing = lavalink.getPlayer(interaction.guildId);
    if (existing && existing.voiceChannelId !== voiceChannelId) {
      return interaction.reply({ content: "I'm already playing in another voice channel.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const player =
      existing ??
      lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: 80,
      });
    if (!player.connected) await player.connect();

    const query = interaction.options.getString("query", true).trim();
    const loaded = await loadTracks(player, query, interaction.user);

    if (!loaded) {
      if (!player.queue.current) await player.destroy();
      return interaction.editReply("No results found.");
    }

    let reply: string;
    if (loaded.playlistTitle !== undefined) {
      await player.queue.add(loaded.tracks);
      reply = `Added **${loaded.tracks.length}** tracks from **${loaded.playlistTitle}** to the queue.`;
    } else {
      const track = loaded.tracks[0]!;
      await player.queue.add(track);
      reply = `Added **${track.info.title}** (${formatDuration(track.info.duration ?? 0)}) to the queue.`;
    }

    if (!player.playing) await player.play();
    return interaction.editReply(reply);
  },
};

async function loadTracks(
  player: Player,
  query: string,
  user: User,
): Promise<{ tracks: (Track | UnresolvedTrack)[]; playlistTitle?: string } | null> {
  const suggestion = suggestions.get(query);
  if (suggestion && suggestion.expiresAt > Date.now()) {
    return { tracks: [{ ...suggestion.track, requester: user }] };
  }

  const result = await player.search({ query }, user);
  if (result.loadType === "playlist" && result.tracks.length > 0) {
    return { tracks: result.tracks, playlistTitle: result.playlist?.title ?? "playlist" };
  }
  if (result.loadType !== "error" && result.tracks.length > 0) return { tracks: [result.tracks[0]!] };

  // A YouTube video URL that failed to load: search its video ID instead and keep the exact match.
  const videoId = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/i.exec(query)?.[1];
  if (!videoId) return null;
  const fallback = await player.search({ query: videoId, source: "ytsearch" }, user);
  const match = fallback.tracks.find((track) => track.info.identifier === videoId);
  return match ? { tracks: [match] } : null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
