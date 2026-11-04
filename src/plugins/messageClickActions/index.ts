/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs, EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { ApplicationIntegrationType } from "@vencord/discord-types/enums";
import { AuthenticationStore, FluxDispatcher, MessageActions, PermissionsBits, PermissionStore, WindowStore } from "@webpack/common";

type Modifier = "BACKSPACE" | "DELETE" | "SHIFT" | "CTRL" | "ALT";

const logger = new Logger("MessageClickActions");

const KEY_MODIFIERS: Record<string, Modifier> = {
    Backspace: "BACKSPACE",
    Delete: "DELETE",
    Shift: "SHIFT",
    Control: "CTRL",
    Alt: "ALT"
};

const settings = definePluginSettings({
    modifier: {
        type: OptionType.SELECT,
        description: "Key to hold while clicking a message to delete it",
        options: [
            { label: "Backspace", value: "BACKSPACE", default: true },
            { label: "Delete", value: "DELETE" },
            { label: "Shift", value: "SHIFT" },
            { label: "Ctrl", value: "CTRL" },
            { label: "Alt", value: "ALT" }
        ]
    },
    deleteOthers: {
        type: OptionType.BOOLEAN,
        description: "Also delete other people's messages when you have permission to",
        default: true
    },
    disableInDms: {
        type: OptionType.BOOLEAN,
        description: "Disable fast delete in direct messages",
        default: false
    }
});

const pressedKeys = new Set<Modifier>();

const onKeyDown = (e: KeyboardEvent) => {
    const mod = KEY_MODIFIERS[e.key];
    if (mod) pressedKeys.add(mod);
};

const onKeyUp = (e: KeyboardEvent) => {
    const mod = KEY_MODIFIERS[e.key];
    if (mod) pressedKeys.delete(mod);
};

const onFocusChange = () => {
    if (!WindowStore.isFocused()) pressedKeys.clear();
};

function canDelete(msg: Message, channel: Channel) {
    const myId = AuthenticationStore.getId();
    if (msg.author.id === myId) return true;
    if (!settings.store.deleteOthers) return false;
    return PermissionStore.can(PermissionsBits.MANAGE_MESSAGES, channel) ||
        msg.interactionMetadata?.authorizing_integration_owners?.[ApplicationIntegrationType.USER_INSTALL] === myId;
}

function removeFromChat(channelId: string, id: string) {
    FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id, mlDeleted: true });
}

export default definePlugin({
    name: "MessageClickActions",
    description: "Hold Backspace (or another key you pick) and click a message to delete it instantly.",
    tags: ["Chat", "Shortcuts"],
    authors: [Devs.Ven, EquicordDevs.keircn, EquicordDevs.ZcraftElite, EquicordDevs.omaw],
    isModified: true,
    settings,

    start() {
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);
        WindowStore.addChangeListener(onFocusChange);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        WindowStore.removeChangeListener(onFocusChange);
        pressedKeys.clear();
    },

    onMessageClick(msg, channel, event) {
        if (event.button !== 0 || !pressedKeys.has(settings.store.modifier as Modifier)) return;
        if (settings.store.disableInDms && channel.isDM()) return;
        if (!canDelete(msg, channel)) return;

        event.preventDefault();

        if (msg.deleted) {
            removeFromChat(channel.id, msg.id);
            return;
        }

        Promise.resolve(MessageActions.deleteMessage(channel.id, msg.id))
            .then(() => removeFromChat(channel.id, msg.id))
            .catch(e => logger.error("Failed to delete message:", e));
    },
});
