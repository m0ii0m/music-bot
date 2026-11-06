import { MessageFlags, type RepliableInteraction } from "discord.js";
import type { LavalinkManager, Player } from "lavalink-client";

/** Returns the guild's player if the user is listening in the same voice channel, otherwise replies and returns null. */
export async function getPlayerForMember(
  interaction: RepliableInteraction<"cached">,
  lavalink: LavalinkManager,
): Promise<Player | null> {
  const player = lavalink.getPlayer(interaction.guildId);
  if (!player) {
    await interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
    return null;
  }
  if (interaction.member.voice.channelId !== player.voiceChannelId) {
    await interaction.reply({ content: "You need to be in my voice channel.", flags: MessageFlags.Ephemeral });
    return null;
  }
  return player;
}
