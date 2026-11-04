import { pause } from "./pause.js";
import { play } from "./play.js";
import { queue } from "./queue.js";
import { resume } from "./resume.js";
import { skip } from "./skip.js";
import { stop } from "./stop.js";
import type { Command } from "./types.js";

export const commands = new Map<string, Command>(
  [play, skip, stop, pause, resume, queue].map((command) => [command.data.name, command]),
);
