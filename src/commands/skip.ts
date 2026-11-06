import { SlashCommandBuilder } from "discord.js";
import { skipTrack } from "../utils/playback.js";
import { getPlayerForMember } from "./guards.js";
import type { Command } from "./types.js";

export const skip: Command = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),

  async execute(interaction, lavalink) {
    const player = await getPlayerForMember(interaction, lavalink);
    if (!player) return;

    const result = await skipTrack(player);
    return interaction.reply(result === "emptied" ? "Skipped. The queue is now empty." : "Skipped.");
  },
};
