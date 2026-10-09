import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_MAX_LENGTH, sanitizeChatText } from "../../shared/nearby";
import { isPlayerActive, playerChatName } from "../../shared/player";
import { getAccount } from "../auth/session";
import { registerCommand } from "../commands/registry";
import { applyJail, applyUnjail, isJailed } from "../prison/sentence";
import { hasAdminAccess } from "./session";

const MIN_LEVEL = 3;
const MIN_MINUTES = 1;
const MAX_MINUTES = 10_080;

function parseArgs(
  args: string
): { slot: number; minutes: number; reason: string } | null {
  const raw = args.trim();
  const parts = raw.split(/\s+/);
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const slot = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(slot) || slot < 0 || !Number.isInteger(minutes)) {
    return null;
  }

  if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return null;
  }

  const reason = sanitizeChatText(parts.slice(2).join(" ").trim()).slice(0, CHAT_MAX_LENGTH);
  return { slot, minutes, reason };
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

export function bindAdminJail(): void {
  registerCommand(
    "jail",
    "将玩家关入监狱",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const parsed = parseArgs(args);
      if (!parsed) {
        player.sendClientMessage(
          Color.error,
          "用法: /jail [id] [分钟] [原因 (可选)]"
        );
        return;
      }

      const target = findTarget(parsed.slot);
      if (!target) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      const account = getAccount(target);
      if (!account) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      if (isJailed(target)) {
        player.sendClientMessage(Color.error, "玩家已经在监狱里。");
        return;
      }

      if (account.adminLevel >= 1) {
        player.sendClientMessage(Color.error, "不能将管理员关进监狱。");
        return;
      }

      void applyAndAnnounce(player, target, parsed.minutes, parsed.reason);
    },
    true
  );

  registerCommand(
    "unjail",
    "释放玩家出狱",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const raw = args.trim();
      const slot = Number(raw);
      if (!raw || !Number.isInteger(slot) || slot < 0) {
        player.sendClientMessage(Color.error, "用法: /unjail [id]");
        return;
      }

      const target = findTarget(slot);
      if (!target) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      const account = getAccount(target);
      if (!account) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      if (!isJailed(target)) {
        player.sendClientMessage(Color.error, "玩家不在监狱里。");
        return;
      }

      void applyUnjailAndAnnounce(player, target);
    },
    true
  );
}

async function applyAndAnnounce(
  admin: Player,
  target: Player,
  minutes: number,
  reason: string
): Promise<void> {
  const ok = await applyJail(target, minutes);
  if (!ok) {
    admin.sendClientMessage(Color.error, "无法将玩家关进监狱。");
    return;
  }

  const adminTag = playerChatName(admin);
  const targetTag = playerChatName(target);
  const line = reason
    ? `管理员 ${adminTag} 将玩家 ${targetTag} 关入监狱 ${minutes} 分钟。原因：${reason}。`
    : `管理员 ${adminTag} 将玩家 ${targetTag} 关入监狱 ${minutes} 分钟。`;
  broadcastAll(Color.error, line);
}

async function applyUnjailAndAnnounce(admin: Player, target: Player): Promise<void> {
  const ok = await applyUnjail(target);
  if (!ok) {
    admin.sendClientMessage(Color.error, "无法释放玩家。");
    return;
  }

  const adminTag = playerChatName(admin);
  const targetTag = playerChatName(target);
  broadcastAll(
    Color.error,
    `管理员 ${adminTag} 释放了玩家 ${targetTag}。`
  );
}
