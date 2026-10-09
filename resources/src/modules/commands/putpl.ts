import { omp, type Player, type Vehicle } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_RADIUS, WHISPER_RADIUS, arePlayersNearby, sendNearby } from "../../shared/nearby";
import { isPlayerActive, playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getAccount } from "../auth/session";
import {
  isCuffed,
  releaseCuffForVehiclePut,
  scheduleCuffRefreeze,
} from "../cuff";
import { isJailed } from "../prison/sentence";
import { resolveLawNearbyTarget } from "./law-target";
import { registerCommand } from "./registry";

const PLAYER_STATE_DRIVER = 2;
const PASSENGER_SEATS = [1, 2, 3] as const;

registerCommand(
  "putpl",
  "将玩家带上自己的车辆（警察 / FBI）",
  (player, args) => {
    const resolved = resolveLawNearbyTarget(
      player,
      args,
      "用法： /putpl [id]"
    );
    if (!resolved.ok) {
      return;
    }

    const { officer, target } = resolved;

    if (isJailed(target)) {
      officer.sendClientMessage(Color.error, "玩家已经在监狱里。");
      return;
    }

    let vehicle: Vehicle | null = null;
    let vehicleId = -1;
    try {
      if (!officer.isInAnyVehicle() || officer.getState() !== PLAYER_STATE_DRIVER) {
        officer.sendClientMessage(Color.error, "你必须坐在驾驶位。");
        return;
      }

      vehicleId = officer.getVehicleID();
      if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
        officer.sendClientMessage(Color.error, "你必须坐在驾驶位。");
        return;
      }

      vehicle = omp.vehicles.at(vehicleId) ?? null;
    } catch {
      officer.sendClientMessage(Color.error, "你必须坐在驾驶位。");
      return;
    }

    if (!vehicle) {
      officer.sendClientMessage(Color.error, "你必须坐在驾驶位。");
      return;
    }

    try {
      if (target.isInAnyVehicle() && target.getVehicleID() === vehicleId) {
        officer.sendClientMessage(Color.error, "该玩家已经在你的载具里。");
        return;
      }
    } catch {
      officer.sendClientMessage(Color.error, "未找到玩家。");
      return;
    }

    if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
      officer.sendClientMessage(Color.error, "玩家距离太远。");
      return;
    }

    const seat = findFreePassengerSeat(vehicleId);
    if (seat === null) {
      officer.sendClientMessage(Color.error, "载具内没有空位。");
      return;
    }

    const wasCuffed = isCuffed(target);
    if (wasCuffed) {
      releaseCuffForVehiclePut(target);
    }

    try {
      if (target.isInAnyVehicle()) {
        target.removeFromVehicle();
      }

      target.putInVehicle(vehicle, seat);
      target.setCameraBehind();
    } catch {
      if (wasCuffed) {
        scheduleCuffRefreeze(target, 0);
      }
      officer.sendClientMessage(Color.error, "无法将玩家放入载具。");
      return;
    }

    if (wasCuffed) {
      scheduleCuffRefreeze(target, 1000);
    }

    const officerName = playerName(officer);
    const targetName = playerName(target);
    const verb = byGender(
      getAccount(officer)?.gender ?? null,
      "送入监狱",
      "送入监狱"
    );

    sendNearby(
      officer,
      CHAT_RADIUS,
      Color.action,
      `${officerName} 将 ${targetName} 带上了车辆。`
    );

    officer.sendClientMessage(Color.info, `你将 ${targetName} 带上了载具。`);
    try {
      target.sendClientMessage(Color.info, `${officerName} ${verb}你上了载具。`);
    } catch {
      // 已离线。
    }
  }
);

function findFreePassengerSeat(vehicleId: number): number | null {
  const taken = new Set<number>();

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      if (!other.isInAnyVehicle() || other.getVehicleID() !== vehicleId) {
        return;
      }

      const seat = other.getVehicleSeat();
      if (Number.isInteger(seat) && seat >= 0) {
        taken.add(seat);
      }
    } catch {
      // 槽位为空。
    }
  });

  for (const seat of PASSENGER_SEATS) {
    if (!taken.has(seat)) {
      return seat;
    }
  }

  return null;
}
