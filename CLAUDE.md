# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Discord music bot: TypeScript (ESM, Node >= 22.9) on discord.js v14, with audio handled by a separate Lavalink v4 server through `lavalink-client`.

## Commands

- `npm run dev`: run from sources with `tsx watch`, loading `.env`. Needs a reachable Lavalink (see below).
- `npm run typecheck`: `tsc --noEmit`. This is the only automated check; there is no test suite and no linter.
- `npm run build` / `npm start`: compile to `dist/` and run the compiled bot.
- `docker compose up --build`: bot + Lavalink together (run `mkdir -p .docker-data/lavalink-plugins` first).

Running the bot outside Docker: Lavalink publishes no port in `docker-compose.yml`. Add a git-ignored `docker-compose.override.yml` that maps `127.0.0.1:2333:2333` on the `lavalink` service, run `docker compose up -d lavalink`, then `npm run dev`.

Set `DISCORD_GUILD_ID` in dev so slash commands register on that one guild right away. In that mode the bot also clears its global commands, otherwise Discord lists each command twice. Global registration can take up to an hour to show up.

## Architecture

- `src/index.ts` creates the Discord client (intents: `Guilds` and `GuildVoiceStates` only) and the Lavalink manager, and **forwards every raw gateway packet to `lavalink.sendRawData`**, which Lavalink needs for voice. On `ClientReady` it calls `lavalink.init(...)` and then **overwrites** the full slash-command set with `application.commands.set(...)` on every startup. Interactions outside a guild are rejected, so commands always get a `ChatInputCommandInteraction<"cached">`. Command errors are caught centrally and the handler replies or edits the reply depending on whether the command already deferred.
- `src/lavalink.ts` sets up `LavalinkManager`: a single node `"main"`, `ytsearch` as the default search platform, players destroyed on disconnect and 60 s after the queue empties. The "Now playing" message is sent from the `trackStart` event to `player.textChannelId`, not from the commands.
- `src/config.ts` reads env vars once at import time and throws if `DISCORD_TOKEN` or `LAVALINK_PASSWORD` is missing.
- Commands: each file in `src/commands/` exports a `Command` (`types.ts`: `data` builder + `execute(interaction, lavalink)`). **A new command must be added to the array in `src/commands/index.ts`**, which keys the registry by command name. There is one player per guild (`lavalink.getPlayer(guildId)`). Commands that act on an existing player use `getPlayerForMember` (`guards.ts`), which replies with an ephemeral error and returns `null` when nothing is playing or the user is in a different voice channel. `/play` creates and connects the player itself and defers its reply because searching is slow.
- Conventions: user errors are sent as ephemeral replies (`MessageFlags.Ephemeral`) and successes as public ones. The tsconfig uses `nodenext`, `verbatimModuleSyntax` and `noUncheckedIndexedAccess`, so relative imports need a `.js` extension, type-only imports need `import type`, and indexed access needs `!` or a check.

## Deployment

- `docker-compose.yml` is the local setup (builds the image). `docker-compose.prod.yml` is the server setup: it pulls `m0ii0m69/music-bot:latest` and mounts the Lavalink plugins dir under `/mnt/Stockage1/...`.
- `.github/workflows/docker.yml` runs only when started by hand (`workflow_dispatch`). It builds linux/amd64 and pushes `latest` and `sha` tags to Docker Hub, and the server pulls `latest` within about 5 minutes.
- The Dockerfile runs `npm ci`, so `package-lock.json` must exist (and be committed for the CI build).
- YouTube playback comes from the Lavalink `youtube-plugin`, configured through env vars in both compose files. Lavalink's built-in YouTube source is turned off. Keep the two compose files in sync when changing the plugin or Lavalink settings. Playback needs all three of these (since 2026-08, release 1.18.2 fails with "requires login" / "No supported audio streams" / "Must find sig function"):
  - a **snapshot build** of the plugin (`LAVALINK_PLUGINS_0_SNAPSHOT=true`) until a release newer than 1.18.2 ships;
  - **OAuth** on a burner Google account, used only by the `TV` client, which must be the first playback-capable client in `PLUGINS_YOUTUBE_CLIENTS_*` (`MUSIC` is listed first but only searches; `TV` cannot search). The refresh token lives in `.env` as `YOUTUBE_REFRESH_TOKEN`. When it is empty, Lavalink logs a google.com/device code and then the new token;
  - the **`yt-cipher`** service (remote signature deciphering), reached on the internal network and protected by `LAVALINK_PASSWORD`.
- `.gitattributes` forces LF line endings for all files.
