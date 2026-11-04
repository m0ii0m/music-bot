import { SlashCommandBuilder } from "discord.js";
import { getPlayerForMember } from "./guards.js";
import type { Command } from "./types.js";

export const stop: Command = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop the music, clear the queue and leave"),

  async execute(interaction, lavalink) {
    const player = await getPlayerForMember(interaction, lavalink);
    if (!player) return;

    await player.destroy();
    return interaction.reply("Stopped and left the voice channel.");
  },
};
