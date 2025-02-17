// Controller for channels where only images may be sent

import { PrismaClient } from "@prisma/client";
import * as Discord from "discord.js";
import * as Builders from "@discordjs/builders";

import { CommandDescriptor } from "../bot.d";
import * as utils from "./utils";
import logger from "../logger";

export async function handleMessage(
	message: Discord.Message,
	prisma: PrismaClient,
	galleries?: Discord.Snowflake[]
): Promise<boolean> {
	if (
		message.author.bot ||
		message.member?.roles.cache.has(process.env.ADMIN_ID as string)
	) {
		return false;
	}

	// TODO: cache this vv
	if (galleries === undefined) {
		galleries = await utils.fetchGalleries(prisma);
	}

	if (galleries.includes(message.channelId)) {
		if (
			!message.attachments.size &&
			!message.content.startsWith("https://")
		) {
			const sermon = await message.reply({
				content: `This is a gallery channel, ${message.author}, so only images may be sent here.`,
				allowedMentions: { users: [message.author.id] },
				failIfNotExists: false,
			});
			await message.delete().catch(() => undefined);
			setTimeout(
				async () => await sermon.delete().catch(() => undefined),
				5000
			);
			return true;
		}
	}

	return false;
}

export async function parseExistingMessages(
	prisma: PrismaClient,
	channels: (Discord.TextChannel | Discord.ThreadChannel)[]
): Promise<number> {
	let count = 0;
	for (const channel of channels) {
		try {
			const messages = await utils.fetchAllChannelMessages(channel);

			for (const [_id, message] of messages) {
				try {
					if (await handleMessage(message, prisma, [channel.id])) {
						count++;
					}
				} catch (e) {
					// do nothing
				}
			}
		} catch (e) {
			// do nothing
		}
	}
	return count;
}

export function provideCommands(): CommandDescriptor[] {
	const cmd = new Builders.SlashCommandBuilder()
		.setName("gallery-channels")
		.setDescription("Controller for the gallery-channels module");
	cmd.addSubcommand(
		new Builders.SlashCommandSubcommandBuilder()
			.setName("add")
			.setDescription("Add a new gallery channel")
			.addChannelOption(
				new Builders.SlashCommandChannelOption()
					.setName("channel")
					.setDescription("Existing messages will be preserved")
					.setRequired(true)
			)
	);
	cmd.addSubcommand(
		new Builders.SlashCommandSubcommandBuilder()
			.setName("remove")
			.setDescription("Remove a gallery channel")
			.addChannelOption(
				new Builders.SlashCommandChannelOption()
					.setName("channel")
					.setDescription("New messages will no longer be moderated")
					.setRequired(true)
			)
	);
	cmd.addSubcommand(
		new Builders.SlashCommandSubcommandBuilder()
			.setName("list")
			.setDescription("List existing gallery channels")
	);
	cmd.addSubcommand(
		new Builders.SlashCommandSubcommandBuilder()
			.setName("clean")
			.setDescription("Clean (an) existing gallery channel(s)")
			.addChannelOption(
				new Builders.SlashCommandChannelOption()
					.setName("channel")
					.setDescription(
						"If specified, only this channel will be cleaned"
					)
					.setRequired(false)
			)
	);
	return [
		{
			builder: cmd,
			handler: handleCommand,
		},
	];
}

async function updateGalleries(
	prisma: PrismaClient,
	newVal: Discord.Snowflake[]
) {
	const value = newVal.join(",");
	await prisma.config.upsert({
		where: { key: "gallery_channels" },
		update: { value },
		create: {
			key: "gallery_channels",
			value,
		},
	});
}

export async function handleCommand(
	interaction: Discord.ChatInputCommandInteraction,
	prisma: PrismaClient
): Promise<void> {
	const galleries = await utils.fetchGalleries(prisma);

	switch (interaction.options.getSubcommand()) {
		case "add": {
			try {
				const channel = interaction.options.getChannel(
					"channel",
					true
				).id;

				if (galleries.includes(channel)) {
					await interaction.editReply(
						utils.XEmoji + "Channel is already a gallery."
					);
				} else {
					logger.info({ channel }, "Added a gallery channel");
					galleries.push(channel);
					await updateGalleries(prisma, galleries);
					await interaction.editReply(
						utils.CheckMarkEmoji + "Gallery successfully added."
					);
				}
			} catch (e) {
				logger.error(e, "Error while adding a gallery channel");
				await interaction.editReply(
					utils.XEmoji + "Something went wrong."
				);
			}
			break;
		}
		case "remove": {
			try {
				const channel = interaction.options.getChannel(
					"channel",
					true
				).id;

				if (!galleries.includes(channel)) {
					await interaction.editReply(
						utils.XEmoji + "Channel is not a gallery."
					);
				} else {
					await updateGalleries(
						prisma,
						galleries.filter((c) => c != channel)
					);
					logger.info({ channel }, "Removed a gallery channel");
					await interaction.editReply(
						utils.CheckMarkEmoji + "Gallery successfully removed."
					);
				}
			} catch (e) {
				logger.error(e, "Error while removing a gallery channel");
				await interaction.editReply(
					utils.XEmoji + "Something went wrong."
				);
			}
			break;
		}
		case "list":
			interaction.editReply(
				"**Gallery Channels**\n\n" +
					(galleries.length
						? galleries.map((c) => `- <#${c}>`).join("\n")
						: "*None*")
			);
			break;
		case "clean": {
			try {
				const channel = interaction.options.getChannel(
					"channel",
					false
				) as Discord.GuildChannel | null;
				let channels: (Discord.TextChannel | Discord.ThreadChannel)[] =
					[];
				if (
					channel === null ||
					!(channel.isTextBased() || channel.isThread())
				) {
					for (const c of galleries) {
						const cf = await interaction.client.channels.fetch(c);
						if (cf && (cf.isTextBased() || cf.isThread())) {
							channels.push(
								cf as
									| Discord.TextChannel
									| Discord.ThreadChannel
							);
						}
					}
				} else {
					channels = [
						channel as Discord.TextChannel | Discord.ThreadChannel,
					];
				}
				const n = await parseExistingMessages(prisma, channels);
				logger.info(
					{ channels },
					"Cleaned %d messages from gallery channels",
					n
				);
				await interaction.editReply(
					utils.CheckMarkEmoji + `Cleaned \`${n}\` messages.`
				);
				break;
			} catch (e) {
				logger.error(
					e,
					"Error while cleaning gallery channel messages"
				);
				await interaction.editReply(
					utils.XEmoji + "Something went wrong."
				);
			}
		}
	}
}
