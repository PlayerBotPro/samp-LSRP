import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import {
  applyHealth,
  getAccount,
  isAuthenticated,
  normalizeHealth,
} from "../auth/session";
import { registerCommand } from "../commands/registry";
import { refreshStreamForPlayer } from "../mapping/stream";
import { applyOrgVisuals, resolvePlayerSkin } from "../org";
import { clearPendingHospitalSpawn } from "../spawn";
import { placeAt, writeSpawnInfo } from "../spawn/point";
import { resolveAccountSpawn } from "../spawn/resolve";
import { hasAdminAccess } from "./session";

const MIN_LEVEL = 3;
const PLAYER_STATE_WASTED = 7;
const PLAYER_STATE_SPECTATING = 9;
const PLACE_AFTER_SPAWN_MS = 80;

function broadcastAdmins(text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other) || !hasAdminAccess(other, 1)) {
      return;
    }

    try {
      other.sendClientMessage(Color.gray, text);
    } catch {
      // 槽位为空.
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

function leaveVehicle(player: Player): void {
  try {
    if (player.isInAnyVehicle()) {
      player.removeFromVehicle();
    }
  } catch {
    // 已经下车.
  }
}

function needsForceSpawn(player: Player): boolean {
  try {
    if (!player.isSpawned()) {
      return true;
    }

    const state = player.getState();
    return state === PLAYER_STATE_WASTED || state === PLAYER_STATE_SPECTATING;
  } catch {
    return true;
  }
}

function exitSpectate(player: Player): void {
  try {
    player.toggleSpectating(false);
  } catch {
    // 已退出观察模式.
  }

  try {
    player.toggleControllable(true);
  } catch {
    // 控制状态会在 placeAt 后设置.
  }
}

function placeSpawnedPlayer(target: Player): boolean {
  const account = getAccount(target);
  if (!account || !isAuthenticated(target) || !isPlayerActive(target)) {
    return false;
  }

  const point = resolveAccountSpawn(account);

  try {
    leaveVehicle(target);
    applyOrgVisuals(target);
    placeAt(target, point);
    applyHealth(target, normalizeHealth(account.health));
    refreshStreamForPlayer(target);
    return true;
  } catch {
    return false;
  }
}

function spawnToAccountPoint(target: Player): boolean {
  const account = getAccount(target);
  if (!account || !isAuthenticated(target)) {
    return false;
  }

  const targetSlot = playerId(target);
  if (targetSlot === null) {
    return false;
  }

  const point = resolveAccountSpawn(account);
  const skin = resolvePlayerSkin(account);
  const force = needsForceSpawn(target);

  leaveVehicle(target);
  exitSpectate(target);

  // 否则 OnPlayerSpawn 会在管理员重生后显示"你失去了意识......".
  clearPendingHospitalSpawn(target);

  try {
    if (force) {
      writeSpawnInfo(target, skin, point);
      target.spawn();
      // 等待 OnPlayerSpawn,否则 placeAt 可能被死亡/医院处理器覆盖.
      setTimeout(() => {
        if (!isPlayerActive(target) || playerId(target) !== targetSlot) {
          return;
        }

        if (!isAuthenticated(target) || getAccount(target)?.id !== account.id) {
          return;
        }

        placeSpawnedPlayer(target);
      }, PLACE_AFTER_SPAWN_MS);
      return true;
    }

    return placeSpawnedPlayer(target);
  } catch {
    return false;
  }
}

export function bindAdminSpawn(): void {
  registerCommand(
    "spawn",
    "重生自己或其他玩家",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const raw = args.trim();
      let target = player;

      if (raw) {
        if (!/^\d+$/.test(raw)) {
          player.sendClientMessage(Color.error, "用法: /spawn [id]");
          return;
        }

        const slot = Number(raw);
        if (!Number.isInteger(slot) || slot < 0) {
          player.sendClientMessage(Color.error, "用法: /spawn [id]");
          return;
        }

        const found = findTarget(slot);
        if (!found || !isAuthenticated(found)) {
          player.sendClientMessage(Color.error, "未找到玩家.");
          return;
        }

        target = found;
      } else if (!isAuthenticated(player)) {
        player.sendClientMessage(Color.error, "请先登录账号.");
        return;
      }

      if (!spawnToAccountPoint(target)) {
        player.sendClientMessage(Color.error, "无法使玩家重生.");
        return;
      }

      const adminId = playerId(player);
      const targetId = playerId(target);
      const self = adminId !== null && adminId === targetId;

      if (self) {
        player.sendClientMessage(Color.info, "你已重生.");
        broadcastAdmins(`管理员 ${playerChatName(player)} 让自己重生.`);
        return;
      }

      player.sendClientMessage(
        Color.info,
        `你已使玩家 ${playerChatName(target)} 重生.`
      );
      try {
        target.sendClientMessage(
          Color.info,
          `管理员 ${playerChatName(player)} 已使你重生.`
        );
      } catch {
        // 已离线.
      }

      broadcastAdmins(
        `管理员 ${playerChatName(player)} 让 ${playerChatName(target)} 重生.`
      );
    },
    true
  );
}
