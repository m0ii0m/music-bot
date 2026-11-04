# music-bot

Discord music bot written in TypeScript with [discord.js](https://discord.js.org) and
[Lavalink](https://lavalink.dev) (through [lavalink-client](https://github.com/Tomato6966/lavalink-client)).

Slash commands: `/play`, `/skip`, `/stop`, `/pause`, `/resume`, `/queue`.

## Setup

1. Create an application on the [Discord Developer Portal](https://discord.com/developers/applications),
   copy the bot token, and invite the bot with the `bot` and `applications.commands` scopes
   (permissions: View Channels, Send Messages, Connect, Speak).
2. Copy `.env.example` to `.env` and fill it in.
3. Install dependencies (this also creates `package-lock.json`, required by the Docker build):

   ```bash
   npm install
   ```

## Run with Docker (bot + Lavalink)

```bash
mkdir -p .docker-data/lavalink-plugins
docker compose up --build
```

## Run the bot outside Docker (faster reloads)

Lavalink has no published port in `docker-compose.yml`. To reach it from your machine, create a
`docker-compose.override.yml` (git-ignored):

```yaml
services:
  lavalink:
    ports:
      - "127.0.0.1:2333:2333"
```

Then start Lavalink alone and the bot in watch mode:

```bash
docker compose up -d lavalink
npm run dev
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run from sources with auto-reload (reads `.env`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled bot |
| `npm run typecheck` | Type-check without emitting |
