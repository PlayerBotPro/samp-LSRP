import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CLIENT_MESSAGE_MAX, clipClientMessage, sanitizeChatText } from "../../shared/chat-text";
import { CHAT_RADIUS } from "../../shared/nearby";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated, normalizePhone } from "../auth/session";
import { registerCommand } from "./registry";

const SMS_YELLOW = 0xffff00ff;
const BUBBLE_MS = 3_000;
const SENDER_BUBBLE = "SMS >>";
const RECEIVER_BUBBLE = ">>SMS";

registerCommand("sms", "向电话号码发送短信", (player, args) => {
  sendSms(player, args);
});

function sendSms(player: Player, args: string): void {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  if (!account.phone) {
    player.sendClientMessage(Color.error, "你没有手机,请到 24/7 商店购买.");
    return;
  }

  const parsed = parseSms(args);
  if (!parsed) {
    player.sendClientMessage(Color.error, "用法:/sms [电话号码] [内容]");
    return;
  }

  if (parsed.phone === account.phone) {
    player.sendClientMessage(Color.error, "不能给自己发送短信.");
    return;
  }

  const target = findOnlineByPhone(parsed.phone);
  if (!target) {
    player.sendClientMessage(Color.error, "对方不在线.");
    return;
  }

  const targetAccount = getAccount(target);
  if (!targetAccount?.phone) {
    player.sendClientMessage(Color.error, "对方不在线.");
    return;
  }

  const toSender = smsLine(parsed.text, `收件人: ${targetAccount.name} [电话:${targetAccount.phone}]`);
  const toTarget = smsLine(parsed.text, `发件人: ${account.name} [电话:${account.phone}]`);

  player.sendClientMessage(SMS_YELLOW, toSender);
  target.sendClientMessage(SMS_YELLOW, toTarget);
  showBubble(player, SENDER_BUBBLE);
  showBubble(target, RECEIVER_BUBBLE);
}

function parseSms(args: string): { phone: string; text: string } | null {
  const trimmed = args.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) {
    return null;
  }

  const phone = normalizePhone(trimmed.slice(0, space));
  const text = sanitizeChatText(trimmed.slice(space + 1).trim());
  if (!phone || !text) {
    return null;
  }

  return { phone, text };
}

function findOnlineByPhone(phone: string): Player | null {
  let found: Player | null = null;

  omp.players.forEach((other) => {
    if (found || !isPlayerActive(other) || !isAuthenticated(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    if (getAccount(other)?.phone === phone) {
      found = other;
    }
  });

  return found;
}

function smsLine(text: string, who: string): string {
  const tail = ` | ${who}`;
  const room = CLIENT_MESSAGE_MAX - "SMS: ".length - tail.length;
  const body = room > 0 ? text.slice(0, room) : "";
  return clipClientMessage(`SMS: ${body}${tail}`);
}

function showBubble(player: Player, text: string): void {
  try {
    player.setChatBubble(text, SMS_YELLOW, CHAT_RADIUS, BUBBLE_MS);
  } catch {
    // 短信发送不依赖头顶文字.
  }
}
