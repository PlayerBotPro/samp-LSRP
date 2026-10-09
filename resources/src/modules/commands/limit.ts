import { omp } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { registerCommand } from "./registry";
import {
  MAX_SPEED_LIMIT,
  MIN_SPEED_LIMIT,
  clearVehicleLimit,
  getVehicleLimit,
  setVehicleLimit,
} from "../vehicles/limit";

const PLAYER_STATE_DRIVER = 2;

registerCommand("limit", "Ограничитель скорости машины", (player, args) => {
  let vehicle;
  try {
    if (player.getState() !== PLAYER_STATE_DRIVER) {
      player.sendClientMessage(Color.error, "你必须坐在驾驶位。");
      return;
    }

    vehicle = omp.vehicles.at(player.getVehicleID());
  } catch {
    player.sendClientMessage(Color.error, "你必须坐在驾驶位。");
    return;
  }

  if (!vehicle) {
    player.sendClientMessage(Color.error, "你必须坐在驾驶位。");
    return;
  }

  const raw = args.trim();
  if (!raw) {
    const current = getVehicleLimit(vehicle);
    player.sendClientMessage(
      Color.info,
      current
        ? `这辆车的限速: ${current} km/h.`
        : `用法: /limit [kmh] (${MIN_SPEED_LIMIT}-${MAX_SPEED_LIMIT}, 0 - 关闭)`
    );
    return;
  }

  const kmh = Number(raw);
  if (!Number.isInteger(kmh) || kmh < 0) {
    player.sendClientMessage(
      Color.error,
      `用法: /limit [kmh] (${MIN_SPEED_LIMIT}-${MAX_SPEED_LIMIT}, 0 - 关闭)`
    );
    return;
  }

  if (kmh === 0) {
    clearVehicleLimit(vehicle);
    player.sendClientMessage(Color.info, "限速已取消。");
    return;
  }

  if (kmh < MIN_SPEED_LIMIT || kmh > MAX_SPEED_LIMIT) {
    player.sendClientMessage(
      Color.error,
      `用法: /limit [kmh] (${MIN_SPEED_LIMIT}-${MAX_SPEED_LIMIT}, 0 - 关闭)`
    );
    return;
  }

  const applied = setVehicleLimit(vehicle, kmh);
  if (applied === null) {
    player.sendClientMessage(Color.error, "无法设置限速。");
    return;
  }

  player.sendClientMessage(Color.info, `限速: ${applied} km/h.`);
});
