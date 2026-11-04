import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { getPlayerForMember } from "./guards.js";
import type { Command } from "./types.js";

export const resume: Command = {
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume the paused track"),

  async execute(interaction, lavalink) {
    const player = await getPlayerForMember(interaction, lavalink);
    if (!player) return;

    if (!player.paused) {
      return interaction.reply({ content: "Not paused.", flags: MessageFlags.Ephemeral });
    }
    await player.resume();
    return interaction.reply("Resumed.");
  },
};
