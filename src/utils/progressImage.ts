import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { formatDuration } from "./format.js";

// The Docker image has no system fonts: the bar draws its times with a bundled one.
// src/utils/ and dist/utils/ are both two levels below the project root.
const FONT_FAMILY = "PanelFont";
GlobalFonts.registerFromPath(
  new URL("../../assets/fonts/NotoSans-Medium.ttf", import.meta.url).pathname,
  FONT_FAMILY,
);

// Drawn at twice the size Discord displays it, so it stays sharp on high-density screens.
const WIDTH = 1000;
const HEIGHT = 112;
const KNOB_RADIUS = 18;
const TRACK_Y = 34;
const TRACK_HEIGHT = 14;
const TEXT_Y = 100;
// Mid tones that read on both the dark and the light Discord themes (the background is transparent).
const TRACK_COLOR = "rgba(128, 132, 142, 0.35)";
const TEXT_COLOR = "#8e9099";

/** A PNG of the progress bar: filled track, knob at the current position, elapsed and total times below. */
export function renderProgressImage(position: number, duration: number, accent: string): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const ratio = duration > 0 ? Math.min(Math.max(position / duration, 0), 1) : 0;
  const left = KNOB_RADIUS + 4;
  const right = WIDTH - KNOB_RADIUS - 4;
  const knobX = left + ratio * (right - left);

  ctx.fillStyle = TRACK_COLOR;
  ctx.beginPath();
  ctx.roundRect(left, TRACK_Y - TRACK_HEIGHT / 2, right - left, TRACK_HEIGHT, TRACK_HEIGHT / 2);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(left, TRACK_Y - TRACK_HEIGHT / 2, knobX - left, TRACK_HEIGHT, TRACK_HEIGHT / 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(knobX, TRACK_Y, KNOB_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.font = `30px ${FONT_FAMILY}`;
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "left";
  ctx.fillText(formatDuration(Math.min(position, duration)), left - KNOB_RADIUS, TEXT_Y);
  ctx.textAlign = "right";
  ctx.fillText(formatDuration(duration), right + KNOB_RADIUS, TEXT_Y);

  return canvas.toBuffer("image/png");
}
