import type { Player } from "lavalink-client";
import { isAutoplayEnabled, queueRelatedTrack } from "./autoplay.js";

/**
 * Skips to the next track, or stops playing (staying in the channel) when nothing is queued.
 * With AutoPlay on, an empty queue gets a similar track first, so skipping keeps the music going.
 */
export async function skipTrack(player: Player): Promise<"skipped" | "emptied"> {
  const current = player.queue.current;
  if (player.queue.tracks.length === 0 && current && isAutoplayEnabled(player)) {
    await queueRelatedTrack(player, current).catch((error) => console.error("AutoPlay failed:", error));
  }
  if (player.queue.tracks.length === 0) {
    await player.stopPlaying(false, false);
    return "emptied";
  }
  await player.skip();
  return "skipped";
}

/**
 * Plays the previously played track again and puts the current one back at the front of the queue.
 * Without a previous track, restarts the current one.
 */
export async function playPrevious(player: Player): Promise<void> {
  const current = player.queue.current;
  const previous = await player.queue.shiftPrevious();
  if (!previous) {
    if (current?.info.isSeekable) await player.seek(0);
    return;
  }

  if (current) await player.queue.add(current, 0);
  // In queue loop mode, a finished track is also pushed to the end of the queue: drop that copy,
  // or the track would come back twice.
  const lastIndex = player.queue.tracks.length - 1;
  if (player.repeatMode === "queue" && player.queue.tracks[lastIndex]?.encoded === previous.encoded) {
    await player.queue.remove(lastIndex);
  }
  // Replacing the track does not count it as finished, so the current one is not added to the history.
  await player.play({ clientTrack: previous, paused: false });
}
