import { omp } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, clipClientMessage, sanitizeChatText } from "../../shared/nearby";
import { isPlayerActive, playerChatName } from "../../shared/player";
import { getAccount } from "../auth/session";
import { MAX_ORG_RANK, getMembership } from "../org";
import { registerCommand } from "./registry";

registerCommand("gov", "政府新闻", (player, args) => {
  const account = getAccount(player);
  const membership = account ? getMembership(account) : null;
  if (!account || !membership || !membership.org.gov) {
    player.sendClientMessage(
      Color.error,
      "你不属于政府组织."
    );
    return;
  }

  if (membership.rank.id !== MAX_ORG_RANK) {
    player.sendClientMessage(
      Color.error,
      "政府新闻仅组织领导可发布."
    );
    return;
  }

  const text = sanitizeChatText(args.trim()).slice(0, CHAT_MAX_LENGTH);
  if (!text) {
    player.sendClientMessage(Color.error, "用法: /gov [文本]");
    return;
  }

  const line = clipClientMessage(`政府新闻 ${playerChatName(player)}: ${text}`);

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      other.sendClientMessage(Color.govNews, line);
    } catch {
      // 槽位为空.
    }
  });
});
