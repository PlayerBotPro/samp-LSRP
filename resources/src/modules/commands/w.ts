import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, WHISPER_RADIUS, sanitizeChatText, sendNearby } from "../../shared/nearby";
import { playerChatName } from "../../shared/player";
import { playLocalSpeech } from "../chat/talk";
import { registerCommand } from "./registry";

registerCommand("w", "向附近的人耳语", (player, args) => {
  const text = sanitizeChatText(args.trim()).slice(0, CHAT_MAX_LENGTH);
  if (!text) {
    player.sendClientMessage(Color.error, "用法: /w [文本]");
    return;
  }

  sendNearby(
    player,
    WHISPER_RADIUS,
    Color.whisper,
    `${playerChatName(player)} 低声说道:${text}`
  );
  playLocalSpeech(player, text, { radius: WHISPER_RADIUS, color: Color.whisper });
});
