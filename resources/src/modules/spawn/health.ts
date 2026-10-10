import { omp, Pickup, TextLabel, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import {
  MAX_HEALTH,
  applyHealth,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { STREET_WORLD } from "./point";

const HEART_PICKUP = 1240;
const PICKUP_TYPE = 1;
const PLAYER_STATE_ONFOOT = 1;
const PICKUP_RADIUS = 1.5;
const TICK_MS = 200;
const MSG_COOLDOWN_MS = 3000;
const MAX_FREE_LEVEL = 5;
const LABEL_HEIGHT = 0.85;
const LABEL_DRAW_DISTANCE = 12;

const POINT = {
  x: 1752.7601,
  y: -1885.5597,
  z: 13.5573,
} as const;

const lastMsgAt = new Map<number, number>();

export function startSpawnHealthPickup(): void {
  try {
    new Pickup(HEART_PICKUP, PICKUP_TYPE, POINT.x, POINT.y, POINT.z, STREET_WORLD);
    new TextLabel(
      "医疗",
      Color.info,
      POINT.x,
      POINT.y,
      POINT.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      STREET_WORLD,
      false
    );
  } catch {
    return;
  }

  setInterval(tickHealthPickup, TICK_MS);

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    if (id !== null) {
      lastMsgAt.delete(id);
    }
  });
}

function tickHealthPickup(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    try {
      if (player.getState() !== PLAYER_STATE_ONFOOT) {
        return;
      }

      if (player.getVirtualWorld() !== STREET_WORLD || player.getInterior() !== 0) {
        return;
      }

      const pos = player.getPos();
      if (distance3d(pos.x, pos.y, pos.z, POINT.x, POINT.y, POINT.z) > PICKUP_RADIUS) {
        return;
      }

      tryHeal(player);
    } catch {
      // 槽位为空或玩家已离开.
    }
  });
}

function tryHeal(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  if (account.hospitalized) {
    tell(player, Color.error, "请先在医院接受治疗.");
    return;
  }

  if (account.level > MAX_FREE_LEVEL) {
    tell(player, Color.error, "此项帮助仅对 5 级及以下玩家开放.");
    return;
  }

  let current = account.health;
  try {
    const live = player.getHealth();
    if (live > 0) {
      current = live;
    }
  } catch {
    // 从账户读取生命值.
  }

  if (current >= MAX_HEALTH) {
    return;
  }

  applyHealth(player, MAX_HEALTH);
  patchAccount(player, { health: MAX_HEALTH });
  tell(player, Color.info, "生命值已恢复.");
}

function tell(player: Player, color: number, text: string): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const now = Date.now();
  const last = lastMsgAt.get(id) ?? 0;
  if (now - last < MSG_COOLDOWN_MS) {
    return;
  }

  lastMsgAt.set(id, now);
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
