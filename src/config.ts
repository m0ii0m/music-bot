function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  // When set, slash commands are registered on this guild only (instant update, handy in dev).
  // When empty, they are registered globally (can take up to an hour to show up).
  guildId: process.env.DISCORD_GUILD_ID || undefined,
  lavalink: {
    host: process.env.LAVALINK_HOST || "localhost",
    port: Number(process.env.LAVALINK_PORT || 2333),
    password: required("LAVALINK_PASSWORD"),
  },
};
