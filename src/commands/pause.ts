import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { getPlayerForMember } from "./guards.js";
import type { Command } from "./types.js";

export const pause: Command = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause the current track"),

  async execute(interaction, lavalink) {
    const player = await getPlayerForMember(interaction, lavalink);
    if (!player) return;

    if (player.paused) {
      return interaction.reply({ content: "Already paused.", flags: MessageFlags.Ephemeral });
    }
    await player.pause();
    return interaction.reply("Paused.");
  },
};
