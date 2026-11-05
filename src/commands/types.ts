import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { LavalinkManager } from "lavalink-client";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction<"cached">, lavalink: LavalinkManager): Promise<unknown>;
  /** Suggestions shown above the input while the user types an option marked with `setAutocomplete(true)`. */
  autocomplete?(interaction: AutocompleteInteraction<"cached">, lavalink: LavalinkManager): Promise<unknown>;
}
