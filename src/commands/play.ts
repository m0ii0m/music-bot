import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { formatDuration } from "../utils/format.js";
import type { Command } from "./types.js";

export const play: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or a playlist")
    .addStringOption((option) =>
      option.setName("query").setDescription("Search terms or a URL").setRequired(true),
    ),

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

    const query = interaction.options.getString("query", true);
    const result = await player.search({ query }, interaction.user);

    if (result.loadType === "error" || result.loadType === "empty" || result.tracks.length === 0) {
      if (!player.queue.current) await player.destroy();
      return interaction.editReply("No results found.");
    }

    let reply: string;
    if (result.loadType === "playlist") {
      await player.queue.add(result.tracks);
      reply = `Added **${result.tracks.length}** tracks from **${result.playlist?.title ?? "playlist"}** to the queue.`;
    } else {
      const track = result.tracks[0]!;
      await player.queue.add(track);
      reply = `Added **${track.info.title}** (${formatDuration(track.info.duration ?? 0)}) to the queue.`;
    }

    if (!player.playing) await player.play();
    return interaction.editReply(reply);
  },
};
