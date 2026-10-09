import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, sanitizeChatText } from "../../shared/nearby";
import { isPlayerActive, playerChatName } from "../../shared/player";
import {
  MAX_BAN_DAYS,
  isBanActive,
  kickBannedPlayer,
  parseBannedUntil,
} from "../auth/ban";
import { clearUserBan, findUserByName, parseBanReason, saveUserBan } from "../auth/repository";
import { getAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import { hasAdminAccess } from "./session";

const MIN_LEVEL = 4;
const MIN_DAYS = 1;

function broadcastAll(color: number, text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      other.sendClientMessage(color, text);
    } catch {
      // 槽位为空。
    }
  });
}

function broadcastAdmins(text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other) || !hasAdminAccess(other, 1)) {
      return;
    }

    try {
      other.sendClientMessage(Color.gray, text);
    } catch {
      // 槽位为空。
    }
  });
}

function findTarget(slot: number): Player | null {
  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target)) {
    return null;
  }

  try {
    if (target.isNPC()) {
      return null;
    }
  } catch {
    return null;
  }

  return target;
}

function parseBanArgs(
  args: string
): { slot: number; days: number; reason: string } | null {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 3 || !parts[0] || !parts[1]) {
    return null;
  }

  const slot = Number(parts[0]);
  const days = Number(parts[1]);
  if (!Number.isInteger(slot) || slot < 0 || !Number.isInteger(days)) {
    return null;
  }

  if (days < MIN_DAYS || days > MAX_BAN_DAYS) {
    return null;
  }

  const reason = sanitizeChatText(parts.slice(2).join(" ").trim()).slice(0, CHAT_MAX_LENGTH);
  if (!reason) {
    return null;
  }

  return { slot, days, reason };
}

async function applyBan(
  admin: Player,
  target: Player,
  days: number,
  reason: string
): Promise<void> {
  const account = getAccount(target);
  if (!account) {
    admin.sendClientMessage(Color.error, "玩家尚未登录。");
    return;
  }

  const untilUnix = Math.floor(Date.now() / 1000) + days * 86_400;

  try {
    await saveUserBan(account.id, untilUnix, reason);
  } catch {
    admin.sendClientMessage(Color.error, "无法保存封禁记录。");
    return;
  }

  const adminTag = playerChatName(admin);
  const targetTag = playerChatName(target);
  broadcastAll(
    Color.error,
    `管理员 ${adminTag} 封禁了玩家 ${targetTag}，时长 ${days} 天。原因：${reason}。`
  );

  if (!isPlayerActive(target) || getAccount(target)?.id !== account.id) {
    return;
  }

  kickBannedPlayer(target, untilUnix, reason);
}

async function applyUnban(admin: Player, rawName: string): Promise<void> {
  const name = rawName.trim();
  if (!name || name.includes(" ") || name.length > 24) {
    admin.sendClientMessage(Color.error, "用法: /unban [Nick_Name]");
    return;
  }

  let row;
  try {
    row = await findUserByName(name);
  } catch {
    admin.sendClientMessage(Color.error, "无法检查封禁状态。");
    return;
  }

  if (!row) {
    admin.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  const until = parseBannedUntil(row.banned_until);
  if (!isBanActive(until)) {
    admin.sendClientMessage(Color.error, "该玩家未被封禁。");
    return;
  }

  try {
    await clearUserBan(row.id);
  } catch {
    admin.sendClientMessage(Color.error, "无法解除封禁。");
    return;
  }

  broadcastAdmins(`管理员 ${playerChatName(admin)} 解封了玩家 ${row.name}。`);
}

export function bindAdminBan(): void {
  registerCommand(
    "ban",
    "封禁玩家",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const parsed = parseBanArgs(args);
      if (!parsed) {
        player.sendClientMessage(
          Color.error,
          "用法: /ban [id] [天数] [原因]"
        );
        return;
      }

      const target = findTarget(parsed.slot);
      if (!target) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      if (!getAccount(target)) {
        player.sendClientMessage(Color.error, "玩家尚未登录。");
        return;
      }

      void applyBan(player, target, parsed.days, parsed.reason);
    },
    true
  );

  registerCommand(
    "unban",
    "解封玩家",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      void applyUnban(player, args);
    },
    true
  );
}
