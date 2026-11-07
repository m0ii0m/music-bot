import type { Client } from "discord.js";
import { LavalinkManager, type Player } from "lavalink-client";
import { config } from "./config.js";
import { autoplayFunction } from "./utils/autoplay.js";
import { setupNowPlaying } from "./nowPlaying.js";

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
      onEmptyQueue: {
        // Leave the voice channel after one minute without anything to play.
        destroyAfterMs: 60_000,
        // Queues a similar track when AutoPlay is on (toggled from the panel).
        autoPlayFunction: autoplayFunction,
      },
    },
  });

  lavalink.nodeManager.on("connect", (node) => console.log(`Lavalink node "${node.id}" connected`));
  lavalink.nodeManager.on("disconnect", (node, reason) =>
    console.warn(`Lavalink node "${node.id}" disconnected`, reason),
  );
  lavalink.nodeManager.on("error", (node, error) => console.error(`Lavalink node "${node.id}" error:`, error));

  const sendToTextChannel = (player: Player, content: string) => {
    if (!player.textChannelId) return;
    const channel = client.channels.cache.get(player.textChannelId);
    if (!channel?.isSendable()) return;
    channel.send(content).catch((error) => console.error("Failed to send message to the text channel:", error));
  };

  setupNowPlaying(client, lavalink);

  // autoSkip moves on to the next track by itself; these only tell the channel why a track was skipped.
  lavalink.on("trackError", (player, track, payload) => {
    const details = [payload.exception?.message, payload.exception?.cause, payload.error].filter(Boolean).join(" | ");
    console.warn(`Track error on "${track?.info.title ?? "unknown"}": ${details}`);
    sendToTextChannel(player, `Could not play **${track?.info.title ?? "this track"}**: ${describeTrackError(details)}`);
  });

  lavalink.on("trackStuck", (player, track, payload) => {
    console.warn(`Track stuck on "${track?.info.title ?? "unknown"}" for ${payload.thresholdMs} ms`);
    sendToTextChannel(player, `**${track?.info.title ?? "This track"}** stopped streaming, skipping it.`);
  });

  return lavalink;
}

function describeTrackError(details: string): string {
  // The playback client (TV, with OAuth) only says "requires login" when the burner account is not
  // age-verified, which in practice means an age-restricted video.
  if (/requires login|confirm your age|age[- ]restricted/i.test(details)) {
    return "YouTube requires a signed-in, age-verified account for this video (usually an age restriction).";
  }
  if (/unavailable|private video|removed/i.test(details)) return "the video is unavailable.";
  return "playback failed on the audio server.";
}
