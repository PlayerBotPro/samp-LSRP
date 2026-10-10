import { omp } from "@omp-node/core";
import type { Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import { isAuthenticated } from "../auth/session";
import { registerCommand } from "./registry";

const PLAYER_STATE_DRIVER = 2;

function parseSlot(args: string): number | null {
  const raw = args.trim().split(/\s+/).filter(Boolean)[0] ?? "";
  if (!raw) {
    return null;
  }

  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 0) {
    return null;
  }

  return slot;
}

function findTarget(slot: number): Player | null {
  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
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

function driverVehicleId(player: Player): number | null {
  try {
    if (!player.isInAnyVehicle() || player.getState() !== PLAYER_STATE_DRIVER) {
      return null;
    }

    const vehicleId = player.getVehicleID();
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
      return null;
    }

    if (!omp.vehicles.at(vehicleId)) {
      return null;
    }

    return vehicleId;
  } catch {
    return null;
  }
}

registerCommand(
  "eject",
  "将玩家赶下自己的车辆",
  (player, args) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const vehicleId = driverVehicleId(player);
    if (vehicleId === null) {
      player.sendClientMessage(Color.error, "你必须坐在驾驶位.");
      return;
    }

    const slot = parseSlot(args);
    if (slot === null) {
      player.sendClientMessage(Color.error, "用法: /eject [id]");
      return;
    }

    const target = findTarget(slot);
    if (!target) {
      player.sendClientMessage(Color.error, "未找到玩家.");
      return;
    }

    const selfId = playerId(player);
    const targetId = playerId(target);
    if (target === player || (selfId !== null && selfId === targetId)) {
      player.sendClientMessage(Color.error, "不能把自己踢出去.");
      return;
    }

    try {
      if (!target.isInAnyVehicle()) {
        player.sendClientMessage(Color.error, "该玩家不在载具中.");
        return;
      }

      if (target.getVehicleID() !== vehicleId) {
        player.sendClientMessage(Color.error, "该玩家不在你的载具中.");
        return;
      }

      // 再次检查:驾驶员可能在两次检查之间下车或更换车辆.
      if (driverVehicleId(player) !== vehicleId) {
        player.sendClientMessage(Color.error, "你必须坐在驾驶位.");
        return;
      }

      target.removeFromVehicle();
    } catch {
      player.sendClientMessage(Color.error, "无法将玩家踢出载具.");
      return;
    }

    player.sendClientMessage(
      Color.info,
      `你把 ${playerName(target)} 踢出了车.`
    );
    try {
      target.sendClientMessage(
        Color.info,
        `${playerName(player)} 把你踢出了车.`
      );
    } catch {
      // 已离线.
    }
  }
);
