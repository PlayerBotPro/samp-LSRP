import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { refreshStreamForPlayer } from "../mapping/stream";
import { placeAt, type SpawnPoint } from "../spawn/point";
import { registerCommand } from "../commands/registry";
import { hasAdminAccess } from "./session";

const MIN_LEVEL = 2;
const PLAYER_STATE_WASTED = 7;
const PLAYER_STATE_SPECTATING = 9;

function canTeleport(player: Player): boolean {
  try {
    if (!player.isSpawned()) {
      return false;
    }

    const state = player.getState();
    return state !== PLAYER_STATE_WASTED && state !== PLAYER_STATE_SPECTATING;
  } catch {
    return false;
  }
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

function parseSlot(args: string): number | null {
  const idPart = args.trim();
  if (!idPart) {
    return null;
  }

  const slot = Number(idPart);
  if (!Number.isInteger(slot) || slot < 0) {
    return null;
  }

  return slot;
}

function leaveVehicle(player: Player): void {
  try {
    if (player.isInAnyVehicle()) {
      player.removeFromVehicle();
    }
  } catch {
    // 已经下车。
  }
}

function readPoint(player: Player): SpawnPoint | null {
  try {
    const pos = player.getPos();
    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      angle: player.getFacingAngle(),
      interior: player.getInterior(),
      world: player.getVirtualWorld(),
    };
  } catch {
    return null;
  }
}

function teleportPlayer(player: Player, point: SpawnPoint): boolean {
  leaveVehicle(player);

  try {
    placeAt(player, point);
    refreshStreamForPlayer(player);
    return true;
  } catch {
    return false;
  }
}

function isSamePlayer(a: Player, b: Player): boolean {
  const aId = playerId(a);
  const bId = playerId(b);
  return aId !== null && aId === bId;
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

export function bindAdminGoto(): void {
  registerCommand(
    "goto",
    "传送到玩家身边",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const slot = parseSlot(args);
      if (slot === null) {
        player.sendClientMessage(Color.error, "用法: /goto [id]");
        return;
      }

      const target = findTarget(slot);
      if (!target) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      if (isSamePlayer(player, target)) {
        player.sendClientMessage(Color.error, "不能传送到自己那里。");
        return;
      }

      if (!canTeleport(player)) {
        player.sendClientMessage(Color.error, "现在不能传送。");
        return;
      }

      const point = readPoint(target);
      if (!point || !teleportPlayer(player, point)) {
        player.sendClientMessage(Color.error, "无法传送。");
        return;
      }

      player.sendClientMessage(
        Color.info,
        `你已传送到 ${playerChatName(target)}.`
      );
      broadcastAdmins(
        `[A] 管理员 ${playerChatName(player)} 传送到了 ${playerChatName(target)} 身边。`
      );
    },
    true
  );

  registerCommand(
    "gethere",
    "将玩家传送到自己身边",
    (player, args) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      const slot = parseSlot(args);
      if (slot === null) {
        player.sendClientMessage(Color.error, "用法: /gethere [id]");
        return;
      }

      const target = findTarget(slot);
      if (!target) {
        player.sendClientMessage(Color.error, "未找到玩家。");
        return;
      }

      if (isSamePlayer(player, target)) {
        player.sendClientMessage(Color.error, "不能传送自己。");
        return;
      }

      if (!canTeleport(target)) {
        player.sendClientMessage(Color.error, "现在不能传送玩家。");
        return;
      }

      const point = readPoint(player);
      if (!point || !teleportPlayer(target, point)) {
        player.sendClientMessage(Color.error, "无法传送玩家。");
        return;
      }

      player.sendClientMessage(
        Color.info,
        `你已将 ${playerChatName(target)} 传送到自己这里。`
      );
      try {
        target.sendClientMessage(
          Color.info,
          `管理员 ${playerChatName(player)} 已将你传送走。`
        );
      } catch {
        // 玩家已离线。
      }

      broadcastAdmins(
        `[A] 管理员 ${playerChatName(player)} 将玩家 ${playerChatName(target)} 传送到了自己身边。`
      );
    },
    true
  );
}
