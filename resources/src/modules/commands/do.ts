import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, CHAT_RADIUS, sanitizeChatText, sendNearby } from "../../shared/nearby";
import { playerName } from "../../shared/player";
import { registerCommand } from "./registry";

registerCommand("do", "描述附近的场景或事件", (player, args) => {
  const text = sanitizeChatText(args.trim()).slice(0, CHAT_MAX_LENGTH);
  if (!text) {
    player.sendClientMessage(Color.error, "用法: /do [描述]");
    return;
  }

  sendNearby(
    player,
    CHAT_RADIUS,
    Color.scene,
    `* ${text} (( ${playerName(player)} ))`
  );
});
