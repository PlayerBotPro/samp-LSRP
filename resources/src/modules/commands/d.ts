import { omp } from "@omp-node/core";
import { Color } from "../../shared/colors";
import {
  CHAT_MAX_LENGTH,
  CHAT_RADIUS,
  clipClientMessage,
  sanitizeChatText,
} from "../../shared/nearby";
import { isPlayerActive, playerChatName } from "../../shared/player";
import { getAccount } from "../auth/session";
import { getMembership } from "../org";
import { registerCommand } from "./registry";

const BUBBLE_MS = 3000;
const BUBBLE_TEXT = "部门频道消息。";

registerCommand("d", "部门无线电", (player, args) => {
  const account = getAccount(player);
  const membership = account ? getMembership(account) : null;
  if (!account || !membership || !membership.org.gov) {
    player.sendClientMessage(
      Color.error,
      "你不属于政府组织。"
    );
    return;
  }

  const text = sanitizeChatText(args.trim()).slice(0, CHAT_MAX_LENGTH);
  if (!text) {
    player.sendClientMessage(Color.error, "用法: /d [文本]");
    return;
  }

  const line = clipClientMessage(
    `[D] ${membership.org.name} - ${membership.rank.title} ${playerChatName(player)}: ${text}`
  );

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    const otherAccount = getAccount(other);
    const otherOrg = otherAccount ? getMembership(otherAccount) : null;
    if (!otherOrg?.org.gov) {
      return;
    }

    try {
      other.sendClientMessage(Color.dept, line);
    } catch {
      // 槽位为空。
    }
  });

  try {
    player.setChatBubble(BUBBLE_TEXT, Color.dept, CHAT_RADIUS, BUBBLE_MS);
  } catch {
    // 聊天气泡不是必需的。
  }
});
