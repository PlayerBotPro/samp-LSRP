import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, CHAT_RADIUS, sanitizeChatText, sendNearby } from "../../shared/nearby";
import { playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getGender } from "../auth/session";
import { registerCommand } from "./registry";

registerCommand("try", "随机尝试:成功或失败", (player, args) => {
  const text = sanitizeChatText(args.trim()).slice(0, CHAT_MAX_LENGTH);
  if (!text) {
    player.sendClientMessage(Color.error, "用法: /try [动作]");
    return;
  }

  const ok = Math.random() < 0.5;
  const tried = byGender(getGender(player), "尝试了", "尝试了");
  const result = ok ? "成功" : "失败";
  const color = ok ? Color.tryOk : Color.tryFail;

  sendNearby(
    player,
    CHAT_RADIUS,
    color,
    `* ${playerName(player)} ${tried} ${text} | ${result}`
  );
});
