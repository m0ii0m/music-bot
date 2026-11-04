import { SlashCommandBuilder } from "discord.js";
import { getPlayerForMember } from "./guards.js";
import type { Command } from "./types.js";

export const skip: Command = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),

  async execute(interaction, lavalink) {
    const player = await getPlayerForMember(interaction, lavalink);
    if (!player) return;

    if (player.queue.tracks.length === 0) {
      await player.stopPlaying(false, false);
      return interaction.reply("Skipped. The queue is now empty.");
    }
    await player.skip();
    return interaction.reply("Skipped.");
  },
};
