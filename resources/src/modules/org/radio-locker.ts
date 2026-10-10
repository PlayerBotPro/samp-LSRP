import { omp, Pickup, TextLabel, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { grantWeapon } from "../anticheat/trust";
import { getAccount, isAuthenticated } from "../auth/session";
import { getMembership } from "./membership";
import { ORG_RADIO_ID, RADIO_INTERIOR, RADIO_WORLD } from "./radio";

const PICKUP_MODEL = 367;
const PICKUP_TYPE = 1;
const PLAYER_STATE_ONFOOT = 1;
const PICKUP_RADIUS = 1.5;
const TICK_MS = 200;
const LABEL_HEIGHT = 0.85;
const LABEL_DRAW_DISTANCE = 12;
const WEAPON_CAMERA = 43;
const CAMERA_AMMO = 36;
const DENY = "你不属于广播中心.";

const POINT = {
  x: 1411.8359,
  y: 1062.7908,
  z: 1058.9091,
} as const;

const inside = new Set<number>();

export function bindRadioLocker(): void {
  new Pickup(PICKUP_MODEL, PICKUP_TYPE, POINT.x, POINT.y, POINT.z, RADIO_WORLD);
  new TextLabel(
    "相机",
    Color.info,
    POINT.x,
    POINT.y,
    POINT.z + LABEL_HEIGHT,
    LABEL_DRAW_DISTANCE,
    RADIO_WORLD,
    false
  );

  setInterval(tickLocker, TICK_MS);

  omp.on("playerConnect", (player) => {
    clearPlayer(player);
  });
  omp.on("playerDisconnect", (player) => {
    clearPlayer(player);
  });
}

function tickLocker(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const id = playerId(player);
    if (id === null) {
      return;
    }

    try {
      if (player.getState() !== PLAYER_STATE_ONFOOT) {
        inside.delete(id);
        return;
      }

      if (
        player.getVirtualWorld() !== RADIO_WORLD ||
        player.getInterior() !== RADIO_INTERIOR
      ) {
        inside.delete(id);
        return;
      }

      const pos = player.getPos();
      if (distance3d(pos.x, pos.y, pos.z, POINT.x, POINT.y, POINT.z) > PICKUP_RADIUS) {
        inside.delete(id);
        return;
      }

      if (inside.has(id)) {
        return;
      }

      inside.add(id);
      tryTake(player);
    } catch {
      // 槽位为空或玩家已离开.
    }
  });
}

function tryTake(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  if (account.hospitalized) {
    tell(player, Color.error, "请先在医院接受治疗.");
    return;
  }

  const membership = getMembership(account);
  if (!membership || membership.org.id !== ORG_RADIO_ID) {
    tell(player, Color.error, DENY);
    return;
  }

  try {
    grantWeapon(player, WEAPON_CAMERA, CAMERA_AMMO);
  } catch {
    tell(player, Color.error, "无法发放相机.");
    return;
  }

  tell(player, Color.info, "你领取了相机.");
}

function tell(player: Player, color: number, text: string): void {
  try {
    player.sendClientMessage(color, text);
  } catch {
    // 玩家已离开.
  }
}

function distance3d(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

function clearPlayer(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    inside.delete(id);
  }
}
