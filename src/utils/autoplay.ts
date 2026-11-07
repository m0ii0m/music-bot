import type { Player, Track, UnresolvedTrack } from "lavalink-client";

const ENABLED_KEY = "autoplay";
/** Requester of the tracks AutoPlay adds, so the panel can tell them apart. */
const AUTOPLAY_REQUESTER = { autoplay: true } as const;
// Long videos in a mix are usually compilations or full albums.
const MAX_DURATION_MS = 15 * 60_000;
// Pick among the first few candidates so two runs from the same track do not always go the same way.
const PICK_AMONG = 3;

export function isAutoplayEnabled(player: Player): boolean {
  return player.getData(ENABLED_KEY) === true;
}

export function setAutoplay(player: Player, enabled: boolean) {
  player.setData(ENABLED_KEY, enabled);
}

export function isAutoplayTrack(track: Track | UnresolvedTrack): boolean {
  return (track.requester as { autoplay?: unknown } | undefined)?.autoplay === true;
}

/**
 * lavalink-client's `onEmptyQueue.autoPlayFunction`: runs when the queue runs out. A track added to the
 * queue here plays next; otherwise `queueEnd` fires as usual.
 */
export async function autoplayFunction(player: Player, lastTrack: Track) {
  if (!isAutoplayEnabled(player) || !lastTrack) return;
  await queueRelatedTrack(player, lastTrack).catch((error) => console.error("AutoPlay failed:", error));
}

/** Adds a track similar to `track` at the end of the queue. Returns whether one was found. */
export async function queueRelatedTrack(player: Player, track: Track): Promise<boolean> {
  const recent = new Set(
    [track, ...player.queue.previous, ...player.queue.tracks].map((t) => t.info.identifier).filter(Boolean),
  );
  const candidates = (await findRelated(player, track)).filter(
    (t) => !recent.has(t.info.identifier) && !t.info.isStream && (t.info.duration ?? 0) <= MAX_DURATION_MS,
  );
  const pick = candidates[Math.floor(Math.random() * Math.min(candidates.length, PICK_AMONG))];
  if (!pick) return false;
  await player.queue.add({ ...pick, requester: AUTOPLAY_REQUESTER });
  return true;
}

async function findRelated(player: Player, track: Track): Promise<(Track | UnresolvedTrack)[]> {
  const { identifier, sourceName, author } = track.info;
  // YouTube's "Mix" playlist of a video lists similar songs (the video itself comes first).
  if (sourceName === "youtube" && identifier) {
    const mix = await player
      .search({ query: `https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}` }, AUTOPLAY_REQUESTER)
      .catch(() => null);
    if (mix?.loadType === "playlist" && mix.tracks.length > 1) return mix.tracks;
  }
  // No mix (another source, or loading failed): fall back to other songs by the same artist.
  if (!author) return [];
  const result = await player.search({ query: author, source: "ytsearch" }, AUTOPLAY_REQUESTER);
  return result.loadType === "error" ? [] : result.tracks;
}
