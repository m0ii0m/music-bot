import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { formatDuration } from "../utils/format.js";
import type { Command } from "./types.js";

const MAX_SHOWN = 10;

export const queue: Command = {
  data: new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),

  async execute(interaction, lavalink) {
    const player = lavalink.getPlayer(interaction.guildId);
    const current = player?.queue.current;
    if (!player || !current) {
      return interaction.reply({ content: "The queue is empty.", flags: MessageFlags.Ephemeral });
    }

    const upcoming = player.queue.tracks;
    const lines = [`**Now playing:** ${current.info.title} (${formatDuration(current.info.duration)})`];
    if (upcoming.length > 0) {
      lines.push("", "**Up next:**");
      upcoming.slice(0, MAX_SHOWN).forEach((track, i) => {
        lines.push(`${i + 1}. ${track.info.title} (${formatDuration(track.info.duration ?? 0)})`);
      });
      if (upcoming.length > MAX_SHOWN) lines.push(`…and ${upcoming.length - MAX_SHOWN} more`);
    }

    return interaction.reply(lines.join("\n"));
  },
};
