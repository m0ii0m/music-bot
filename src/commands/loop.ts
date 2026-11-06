import { SlashCommandBuilder } from "discord.js";
import type { RepeatMode } from "lavalink-client";
import { getPlayerForMember } from "./guards.js";
import type { Command } from "./types.js";

const MESSAGES: Record<RepeatMode, string> = {
  off: "Loop disabled.",
  track: "Looping the current track.",
  queue: "Looping the whole queue.",
};

export const loop: Command = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Repeat the current track or the whole queue")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("What to repeat")
        .setRequired(true)
        .addChoices(
          { name: "Current track", value: "track" },
          { name: "Whole queue", value: "queue" },
          { name: "Off", value: "off" },
        ),
    ),

  async execute(interaction, lavalink) {
    const player = await getPlayerForMember(interaction, lavalink);
    if (!player) return;

    const mode = interaction.options.getString("mode", true) as RepeatMode;
    await player.setRepeatMode(mode);
    return interaction.reply(MESSAGES[mode]);
  },
};
