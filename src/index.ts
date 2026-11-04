import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { commands } from "./commands/index.js";
import { config } from "./config.js";
import { createLavalink } from "./lavalink.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const lavalink = createLavalink(client);

// Lavalink needs the raw voice state/server updates from the gateway.
client.on("raw", (packet) => lavalink.sendRawData(packet));

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await lavalink.init({ id: readyClient.user.id, username: readyClient.user.username });

  const body = [...commands.values()].map((command) => command.data.toJSON());
  if (config.guildId) {
    await readyClient.application.commands.set(body, config.guildId);
    console.log(`Registered ${body.length} commands on guild ${config.guildId}`);
  } else {
    await readyClient.application.commands.set(body);
    console.log(`Registered ${body.length} global commands`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This bot only works in servers.", flags: MessageFlags.Ephemeral });
    return;
  }

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, lavalink);
  } catch (error) {
    console.error(`Error in /${interaction.commandName}:`, error);
    const content = "Something went wrong while running this command.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down`);
  await client.destroy();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.discordToken);
