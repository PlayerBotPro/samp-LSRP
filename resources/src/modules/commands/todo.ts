import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, CHAT_RADIUS, sanitizeChatText, sendNearby } from "../../shared/nearby";
import { playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getGender } from "../auth/session";
import { registerCommand } from "./registry";

registerCommand("todo", "通过 * 描述台词和动作", (player, args) => {
  const split = args.indexOf("*");
  const speech = sanitizeChatText((split === -1 ? args : args.slice(0, split)).trim()).slice(0, CHAT_MAX_LENGTH);
  const action = sanitizeChatText((split === -1 ? "" : args.slice(split + 1).trim())).slice(0, CHAT_MAX_LENGTH);

  if (!speech || !action) {
    player.sendClientMessage(
      Color.error,
      "用法: /todo [台词]*[动作]"
    );
    player.sendClientMessage(Color.gray, "示例: /todo 你好*挥手");
    return;
  }

  const said = byGender(getGender(player), "说道", "说道");

  sendNearby(
    player,
    CHAT_RADIUS,
    Color.chat,
    `«${speech}», — ${said} ${playerName(player)}, ${action}.`
  );
});
