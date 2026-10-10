import { INVALID_VEHICLE_ID, omp, type Vehicle } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName } from "../../shared/player";
import { registerCommand } from "../commands/registry";
import { isActiveRentalVehicle } from "../vehicles/rental";
import { hasAdminAccess } from "./session";

const DELAY_MS = 30_000;
const MIN_LEVEL = 4;

let pending: ReturnType<typeof setTimeout> | null = null;

function broadcastAll(color: number, text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      other.sendClientMessage(color, text);
    } catch {
      // 槽位为空.
    }
  });
}

function vehicleHasPlayer(vehicle: Vehicle): boolean {
  try {
    if (vehicle.getDriver()) {
      return true;
    }
    return vehicle.countOccupants() > 0;
  } catch {
    return true;
  }
}

function occupiedVehicleIds(): Set<number> {
  const ids = new Set<number>();
  omp.players.forEach((player) => {
    try {
      if (!player.isInAnyVehicle()) {
        return;
      }

      const id = player.getVehicleID();
      if (id > 0 && id !== INVALID_VEHICLE_ID) {
        ids.add(id);
      }
    } catch {
      // 槽位为空.
    }
  });
  return ids;
}

function respawnEmptyVehicles(): void {
  const busy = occupiedVehicleIds();
  for (const vehicle of omp.vehicles.all()) {
    try {
      const id = vehicle.getID();
      if (id !== null && busy.has(id)) {
        continue;
      }

      if (id !== null && isActiveRentalVehicle(id)) {
        continue;
      }

      if (vehicleHasPlayer(vehicle)) {
        continue;
      }

      vehicle.setToRespawn();
    } catch {
      // 载具已被摧毁.
    }
  }
}

export function bindAdminRespcar(): void {
  registerCommand(
    "respcar",
    "30 秒后重置所有车辆",
    (player) => {
      if (!hasAdminAccess(player, MIN_LEVEL)) {
        return;
      }

      if (pending) {
        player.sendClientMessage(
          Color.error,
          "载具重生计时器已经启动."
        );
        return;
      }

      const tag = playerChatName(player);
      broadcastAll(
        Color.info,
        `管理员 ${tag} 已启动载具重置.无人乘坐的车辆将在 30 秒后返回原位.`
      );

      pending = setTimeout(() => {
        pending = null;
        respawnEmptyVehicles();
        broadcastAll(
          Color.info,
          `管理员 ${tag} 已重置服务器上所有无人乘坐的载具.`
        );
      }, DELAY_MS);
    },
    true
  );
}
