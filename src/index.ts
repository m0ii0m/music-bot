import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { commands } from "./commands/index.js";
import { config } from "./config.js";
import { createLavalink } from "./lavalink.js";
import { bumpPanel, handlePlayerButton, isPlayerButton } from "./nowPlaying.js";

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
    // Drop global commands left by an earlier run without DISCORD_GUILD_ID, or Discord lists every command twice.
    await readyClient.application.commands.set([]);
    console.log(`Registered ${body.length} commands on guild ${config.guildId} (global commands cleared)`);
  } else {
    await readyClient.application.commands.set(body);
    console.log(`Registered ${body.length} global commands`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (!interaction.inCachedGuild()) return;
    const command = commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction, lavalink);
    } catch (error) {
      // 10062 "Unknown interaction": the search took longer than Discord's 3 s window, the user typed on.
      if ((error as { code?: unknown }).code === 10062) return;
      console.error(`Autocomplete error in /${interaction.commandName}:`, error);
      if (!interaction.responded) await interaction.respond([]).catch(() => {});
    }
    return;
  }

  if (interaction.isButton()) {
    if (!interaction.inCachedGuild() || !isPlayerButton(interaction.customId)) return;
    try {
      await handlePlayerButton(interaction, lavalink);
    } catch (error) {
      console.error(`Error on button ${interaction.customId}:`, error);
      const reply = { content: "Something went wrong with this button.", flags: MessageFlags.Ephemeral } as const;
      // The button is acknowledged with deferUpdate: editReply would overwrite the panel itself.
      if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This bot only works in servers.", flags: MessageFlags.Ephemeral });
    return;
  }

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, lavalink);
    // A public reply lands under the "Now playing" panel: move the panel back to the bottom.
    const player = lavalink.getPlayer(interaction.guildId);
    if (player && (interaction.replied || interaction.deferred) && !interaction.ephemeral) {
      bumpPanel(player, interaction.channelId);
    }
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
