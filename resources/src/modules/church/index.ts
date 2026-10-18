import { Dialog, omp, Pickup, TextLabel, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { grantWeapon, revokeWeapon } from "../anticheat/trust";
import { giveBouquet, hasBouquet } from "../flowers";
import { applyWallet, getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { queueSave } from "../persist";
import { refreshStreamForPlayer } from "../mapping/stream";
import { STREET_WORLD, placeAt, type SpawnPoint } from "../spawn/point";
import type { GameModule } from "../types";

export const CHURCH_WORLD = 17;
export const CHURCH_FLOWERS_DIALOG_ID = 168;

const FLOWERS_PRICE = 500;
const FLOWERS_WEAPON = 14;
const FLOWERS_PICKUP_MODEL = 325;
const FLOWERS_PICKUP_TYPE = 14;
const DIALOG_STYLE_MSGBOX = 0;

const PICKUP_MODEL = 19132;
const PICKUP_TYPE = 1;
const PLAYER_STATE_ONFOOT = 1;
const TELEPORT_COOLDOWN_MS = 1500;
const PICKUP_RADIUS = 1.5;
const TICK_MS = 200;
const LABEL_HEIGHT = 0.85;
const LABEL_DRAW_DISTANCE = 12;
const MAP_ICON_SLOT = 11;
const MAP_ICON_TYPE = 21;
const MAPICON_LOCAL = 0;
const ICON_RADIUS = 300;

const STREET_PICKUP = {
  x: 2256.7644,
  y: -44.5669,
  z: 26.8834,
} as const;

const STREET_ICON = {
  x: 2256.6882,
  y: -44.6464,
  z: 26.8834,
} as const;

const FLOWERS_PICKUP = {
  x: -2010.026,
  y: 1112.052,
  z: 53.4459,
} as const;

const INTERIOR_PICKUP = {
  x: -2000.2738,
  y: 1117.8538,
  z: 53.4459,
} as const;

const FROM_STREET = {
  x: -2002.2726,
  y: 1117.8854,
  z: 53.4459,
  angle: 90.94,
  interior: 0,
} as const;

const MEMORIAL = {
  x: 2240.2036,
  y: -86.2022,
  z: 27.8548,
} as const;

const MEMORIAL_TEXT = [
  "{C4A574}-",
  "{F6F1E7}死亡并非生命的对立面.",
  "{E4D3BE}而是生命在他人记忆中的延续.",
  "{E8C872}只要仍有人记得你,你便依然活着.",
].join("\n");

const FROM_INTERIOR: SpawnPoint = {
  x: 2256.761,
  y: -42.4561,
  z: 26.479,
  angle: 1.5187,
  interior: 0,
  world: STREET_WORLD,
};

const lastTeleportAt = new Map<number, number>();
const flowersOffered = new Set<number>();
const iconShown = new Set<number>();
let flowersPickupId: number | null = null;

export const churchModule: GameModule = {
  name: "church",
  start() {
    new Pickup(
      PICKUP_MODEL,
      PICKUP_TYPE,
      STREET_PICKUP.x,
      STREET_PICKUP.y,
      STREET_PICKUP.z,
      STREET_WORLD
    );
    new TextLabel(
      "教堂\n入口",
      Color.info,
      STREET_PICKUP.x,
      STREET_PICKUP.y,
      STREET_PICKUP.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      STREET_WORLD,
      false
    );

    new Pickup(
      PICKUP_MODEL,
      PICKUP_TYPE,
      INTERIOR_PICKUP.x,
      INTERIOR_PICKUP.y,
      INTERIOR_PICKUP.z,
      CHURCH_WORLD
    );
    new TextLabel(
      "出口",
      Color.info,
      INTERIOR_PICKUP.x,
      INTERIOR_PICKUP.y,
      INTERIOR_PICKUP.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      CHURCH_WORLD,
      false
    );

    const flowersPickup = new Pickup(
      FLOWERS_PICKUP_MODEL,
      FLOWERS_PICKUP_TYPE,
      FLOWERS_PICKUP.x,
      FLOWERS_PICKUP.y,
      FLOWERS_PICKUP.z,
      CHURCH_WORLD
    );
    try {
      flowersPickupId = flowersPickup.getID();
    } catch {
      flowersPickupId = null;
    }
    new TextLabel(
      MEMORIAL_TEXT,
      Color.white,
      MEMORIAL.x,
      MEMORIAL.y,
      MEMORIAL.z + 0.75,
      25,
      STREET_WORLD,
      false
    );

    new TextLabel(
      `鲜花花束\n${formatMoney(FLOWERS_PRICE)}`,
      Color.info,
      FLOWERS_PICKUP.x,
      FLOWERS_PICKUP.y,
      FLOWERS_PICKUP.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      CHURCH_WORLD,
      false
    );

    setInterval(tickChurch, TICK_MS);

    omp.on("playerPickUpPickup", (player, pickup) => {
      if (!isFlowersPickup(pickup) || !isPlayerActive(player)) {
        return;
      }
      // 如果引擎仍因模型 325 自动发放了武器,则只保留已付款的花束.
      restorePaidFlowers(player);
      const slot = playerId(player);
      if (slot !== null && !flowersOffered.has(slot)) {
        flowersOffered.add(slot);
        offerFlowers(player);
      }
    });

    omp.on("dialogResponse", (player, dialogId, response) => {
      if (Number(dialogId) !== CHURCH_FLOWERS_DIALOG_ID || !isPlayerActive(player)) {
        return;
      }
      if (Number(response) === 0) {
        return;
      }
      buyFlowers(player);
    });

    omp.on("playerDisconnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        lastTeleportAt.delete(id);
        flowersOffered.delete(id);
        iconShown.delete(id);
      }
    });

    omp.on("playerConnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        iconShown.delete(id);
      }
    });
  },
};

function tickChurch(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    try {
      const slot = playerId(player);
      const pos = player.getPos();
      const world = player.getVirtualWorld();
      const interior = player.getInterior();
      updateIcon(player, pos.x, pos.y, world, interior);

      if (player.getState() !== PLAYER_STATE_ONFOOT || interior !== 0) {
        if (slot !== null) {
          flowersOffered.delete(slot);
        }
        return;
      }

      if (
        slot !== null &&
        world === CHURCH_WORLD &&
        near(pos.x, pos.y, pos.z, FLOWERS_PICKUP.x, FLOWERS_PICKUP.y, FLOWERS_PICKUP.z)
      ) {
        if (!flowersOffered.has(slot)) {
          flowersOffered.add(slot);
          offerFlowers(player);
        }
      } else if (slot !== null) {
        flowersOffered.delete(slot);
      }

      if (
        world === STREET_WORLD &&
        near(pos.x, pos.y, pos.z, STREET_PICKUP.x, STREET_PICKUP.y, STREET_PICKUP.z)
      ) {
        teleport(player, { ...FROM_STREET, world: CHURCH_WORLD });
        return;
      }

      if (
        world === CHURCH_WORLD &&
        near(pos.x, pos.y, pos.z, INTERIOR_PICKUP.x, INTERIOR_PICKUP.y, INTERIOR_PICKUP.z)
      ) {
        teleport(player, FROM_INTERIOR);
      }
    } catch {
      // 槽位为空或玩家已离线.
    }
  });
}

function updateIcon(
  player: Player,
  x: number,
  y: number,
  world: number,
  interior: number
): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const near =
    world === STREET_WORLD &&
    interior === 0 &&
    Math.hypot(x - STREET_ICON.x, y - STREET_ICON.y) <= ICON_RADIUS;

  if (near) {
    if (iconShown.has(id)) {
      return;
    }

    try {
      player.setMapIcon(
        MAP_ICON_SLOT,
        STREET_ICON.x,
        STREET_ICON.y,
        STREET_ICON.z,
        MAP_ICON_TYPE,
        0,
        MAPICON_LOCAL
      );
      iconShown.add(id);
    } catch {
      // 玩家已离线.
    }
    return;
  }

  if (!iconShown.has(id)) {
    return;
  }

  try {
    player.removeMapIcon(MAP_ICON_SLOT);
  } catch {
    // 玩家已离线.
  }
  iconShown.delete(id);
}

function offerFlowers(player: Player): void {
  if (hasBouquet(player)) {
    player.sendClientMessage(Color.error, "你已经有一束鲜花.");
    return;
  }

  try {
    Dialog.show(
      player,
      CHURCH_FLOWERS_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "鲜花花束",
      `{FFFFFF}是否购买一束鲜花?\n费用: {33CCFF}${formatMoney(FLOWERS_PRICE)}`,
      "购买",
      "取消"
    );
  } catch {
    const slot = playerId(player);
    if (slot !== null) {
      flowersOffered.delete(slot);
    }
  }
}

function buyFlowers(player: Player): void {
  if (!isAuthenticated(player) || !canStandAtFlowers(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }
  if (hasBouquet(player)) {
    player.sendClientMessage(Color.error, "你已经有一束鲜花.");
    return;
  }
  if (account.money < FLOWERS_PRICE) {
    player.sendClientMessage(Color.error, `现金不足,需要 ${formatMoney(FLOWERS_PRICE)}.`);
    return;
  }

  const next = account.money - FLOWERS_PRICE;
  patchAccount(player, { money: next });
  const paid = getAccount(player);
  if (!paid) {
    return;
  }
  applyWallet(player, paid);

  if (!giveBouquet(player)) {
    patchAccount(player, { money: next + FLOWERS_PRICE });
    const restored = getAccount(player);
    if (restored) {
      applyWallet(player, restored);
    }
    player.sendClientMessage(
      Color.error,
      hasBouquet(player)
        ? "你已经有一束鲜花,款项已退还."
        : "无法发放花束,款项已退还."
    );
    return;
  }

  queueSave(player);
  player.sendClientMessage(
    Color.tryOk,
    `你购买了一束鲜花,花费 ${formatMoney(FLOWERS_PRICE)}.赠送:/present [id].`
  );
}

function isFlowersPickup(pickup: Pickup): boolean {
  if (flowersPickupId === null) {
    return false;
  }
  try {
    return pickup.getID() === flowersPickupId;
  } catch {
    return false;
  }
}

function restorePaidFlowers(player: Player): void {
  revokeWeapon(player, FLOWERS_WEAPON);
  if (hasBouquet(player)) {
    grantWeapon(player, FLOWERS_WEAPON, 1);
  }
}

function canStandAtFlowers(player: Player): boolean {
  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT || player.getInterior() !== 0) {
      return false;
    }
    if (player.getVirtualWorld() !== CHURCH_WORLD) {
      return false;
    }
    const pos = player.getPos();
    return near(pos.x, pos.y, pos.z, FLOWERS_PICKUP.x, FLOWERS_PICKUP.y, FLOWERS_PICKUP.z);
  } catch {
    return false;
  }
}

function teleport(player: Player, point: SpawnPoint): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const now = Date.now();
  const last = lastTeleportAt.get(id) ?? 0;
  if (now - last < TELEPORT_COOLDOWN_MS) {
    return;
  }

  lastTeleportAt.set(id, now);

  try {
    placeAt(player, point);
    refreshStreamForPlayer(player);
  } catch {
    // 玩家已离线.
  }
}

function near(x: number, y: number, z: number, px: number, py: number, pz: number): boolean {
  return Math.hypot(x - px, y - py, z - pz) <= PICKUP_RADIUS;
}
