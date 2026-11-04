import type { Client } from "discord.js";
import { LavalinkManager } from "lavalink-client";
import { config } from "./config.js";
import { formatDuration } from "./utils/format.js";

export function createLavalink(client: Client): LavalinkManager {
  const lavalink = new LavalinkManager({
    nodes: [
      {
        id: "main",
        host: config.lavalink.host,
        port: config.lavalink.port,
        authorization: config.lavalink.password,
      },
    ],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
    autoSkip: true,
    playerOptions: {
      defaultSearchPlatform: "ytsearch",
      onDisconnect: { autoReconnect: false, destroyPlayer: true },
      // Leave the voice channel after one minute without anything to play.
      onEmptyQueue: { destroyAfterMs: 60_000 },
    },
  });

  lavalink.nodeManager.on("connect", (node) => console.log(`Lavalink node "${node.id}" connected`));
  lavalink.nodeManager.on("disconnect", (node, reason) =>
    console.warn(`Lavalink node "${node.id}" disconnected`, reason),
  );
  lavalink.nodeManager.on("error", (node, error) => console.error(`Lavalink node "${node.id}" error:`, error));

  lavalink.on("trackStart", (player, track) => {
    if (!track || !player.textChannelId) return;
    const channel = client.channels.cache.get(player.textChannelId);
    if (!channel?.isSendable()) return;
    channel
      .send(`Now playing: **${track.info.title}** by ${track.info.author} (${formatDuration(track.info.duration)})`)
      .catch((error) => console.error("Failed to send now playing message:", error));
  });

  return lavalink;
}
