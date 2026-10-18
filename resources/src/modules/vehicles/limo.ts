import { Dialog, omp, type Player, type Vehicle } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { SERVER_TAG } from "../../shared/brand";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { applyWallet, getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { queueSave } from "../persist";
import { STREET_WORLD } from "../spawn/point";
import { createServerVehicle } from "./spawn";

export const LIMO_RENT_DIALOG_ID = 167;

const MODEL = 409;
const COLOR = 1;
const RESPAWN_SEC = 999_999;
const RENT_PRICE = 1500;
const LEAVE_GRACE_MS = 30_000;
const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
const PLAYER_STATE_WASTED = 7;
const RESPAWN_AFTER_DEATH_MS = 500;
const DIALOG_STYLE_MSGBOX = 0;
const ANIM_SYNC_ALL = 1;

const SPAWN = {
  x: 2280.9358,
  y: -50.5465,
  z: 26.8178,
  angle: 0.5608,
} as const;

type LimoSlot = {
  vehicleId: number;
  renterUserId: number | null;
  renterSlotId: number | null;
  /** 租用者当前在礼宾车内；离开其他车辆时不影响计时器。 */
  seated: boolean;
  leaveTimer: ReturnType<typeof setTimeout> | null;
};

const slotRef: { current: LimoSlot | null } = { current: null };
const pendingOffer = new Set<number>();
let eventsBound = false;

/** 租用者尚未返回时，/respcar 不回收已租用的礼宾车。 */
export function isActiveLimoRental(vehicleId: number): boolean {
  const slot = slotRef.current;
  return !!slot && slot.vehicleId === vehicleId && slot.renterUserId !== null;
}

export function spawnLimoRental(): void {
  const vehicle = createServerVehicle({
    model: MODEL,
    x: SPAWN.x,
    y: SPAWN.y,
    z: SPAWN.z,
    angle: SPAWN.angle,
    color1: COLOR,
    color2: COLOR,
    respawnSec: RESPAWN_SEC,
    world: STREET_WORLD,
  });
  if (!vehicle) {
    omp.log(`礼宾车：无法创建车辆`);
    return;
  }

  const vehicleId = liveVehicleId(vehicle);
  const ptr = vehiclePtr(vehicle);
  if (vehicleId === null || ptr === null) {
    try {
      vehicle.destroy();
    } catch {
      // 已移除。
    }
    omp.log(`礼宾车：车辆没有 ID`);
    return;
  }

  slotRef.current = {
    vehicleId,
    renterUserId: null,
    renterSlotId: null,
    seated: false,
    leaveTimer: null,
  };
  bindLimo();
}

/** 入狱、死亡或离线时立即结束租赁。 */
export function endLimoRental(player: Player, reason: "jail" | "death" | "disconnect"): void {
  const offered = playerId(player);
  if (offered !== null && pendingOffer.has(offered)) {
    pendingOffer.delete(offered);
    setControllable(player, true);
  }

  const slot = slotRef.current;
  if (!slot || slot.renterUserId === null) {
    return;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  const owns =
    (account !== null && slot.renterUserId === account.id) ||
    (slotId !== null && slot.renterSlotId === slotId);
  if (!owns) {
    return;
  }

  finishRental();
  if (reason === "jail" && isPlayerActive(player)) {
    player.sendClientMessage(Color.error, "礼宾车租赁已结束。");
  }
  if (reason === "death" && isPlayerActive(player)) {
    player.sendClientMessage(Color.error, "礼宾车租赁已结束。");
  }
}

function bindLimo(): void {
  if (eventsBound) {
    return;
  }
  eventsBound = true;

  omp.on("playerStateChange", (player, newState, oldState) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    if (newState === PLAYER_STATE_WASTED) {
      endLimoRental(player, "death");
      return;
    }

    if (newState === PLAYER_STATE_DRIVER || newState === PLAYER_STATE_PASSENGER) {
      handleEnter(player, newState === PLAYER_STATE_PASSENGER);
      return;
    }

    if (
      (oldState === PLAYER_STATE_DRIVER || oldState === PLAYER_STATE_PASSENGER) &&
      newState !== PLAYER_STATE_DRIVER &&
      newState !== PLAYER_STATE_PASSENGER
    ) {
      const slotId = playerId(player);
      if (slotId !== null && pendingOffer.has(slotId)) {
        pendingOffer.delete(slotId);
        setControllable(player, true);
      }
      handleLeave(player);
    }
  });

  omp.on("dialogResponse", (player, dialogId, response) => {
    if (Number(dialogId) !== LIMO_RENT_DIALOG_ID || !isPlayerActive(player)) {
      return;
    }
    handleDialog(player, Number(response) !== 0);
  });

  omp.on("playerDeath", (player) => {
    endLimoRental(player, "death");
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null && pendingOffer.has(slotId)) {
      pendingOffer.delete(slotId);
      setControllable(player, true);
    }
    endLimoRental(player, "disconnect");
  });

  omp.on("vehicleDeath", (vehicle) => {
    const slot = slotRef.current;
    if (!slot || liveVehicleId(vehicle) !== slot.vehicleId) {
      return;
    }
    const userId = slot.renterUserId;
    finishRental(RESPAWN_AFTER_DEATH_MS);
    if (userId !== null) {
      notify(userId, "礼宾车租赁已结束。");
    }
  });
}

function handleEnter(player: Player, asPassenger: boolean): void {
  const slot = slotRef.current;
  if (!slot) {
    return;
  }

  let vehicleId = -1;
  try {
    vehicleId = player.getVehicleID();
  } catch {
    return;
  }
  if (vehicleId !== slot.vehicleId) {
    return;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    eject(player);
    return;
  }

  if (slot.renterUserId !== null && slot.renterUserId !== account.id) {
    player.sendClientMessage(Color.error, "这辆礼宾车已被租用。");
    eject(player);
    return;
  }

  if (slot.renterUserId === account.id) {
    slot.seated = true;
    if (slot.leaveTimer) {
      clearLeaveTimer(slot);
      player.sendClientMessage(Color.tryOk, "你已返回礼宾车。");
    }
    return;
  }

  if (asPassenger) {
    player.sendClientMessage(Color.error, "请坐到驾驶位以租用礼宾车。");
    eject(player);
    return;
  }

  if (!account.licenses.car) {
    eject(player);
    return;
  }

  pendingOffer.add(slotId);
  setControllable(player, false);
  try {
    Dialog.show(
      player,
      LIMO_RENT_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "礼宾车租赁",
      `{FFFFFF}是否租用礼宾车？\n费用： {33CCFF}${formatMoney(RENT_PRICE)}\n\n{FFFFFF}下车后，你有 30 秒时间返回车辆。`,
      "租用",
      "取消"
    );
  } catch {
    pendingOffer.delete(slotId);
    setControllable(player, true);
    eject(player);
  }
}

function handleDialog(player: Player, accepted: boolean): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }
  pendingOffer.delete(slotId);
  setControllable(player, true);

  const slot = slotRef.current;
  if (!slot) {
    return;
  }

  if (!accepted) {
    eject(player);
    return;
  }

  const account = getAccount(player);
  if (!account || !isAuthenticated(player)) {
    eject(player);
    return;
  }
  if (!account.licenses.car) {
    player.sendClientMessage(Color.error, "你没有汽车驾驶执照。");
    eject(player);
    return;
  }
  if (slot.renterUserId !== null) {
    player.sendClientMessage(Color.error, "这辆礼宾车已被租用。");
    eject(player);
    return;
  }
  if (!isDriverOf(player, slot.vehicleId)) {
    player.sendClientMessage(Color.error, "请坐到礼宾车的驾驶位以租用车辆。");
    return;
  }
  if (account.money < RENT_PRICE) {
    player.sendClientMessage(Color.error, `现金不足，需要 ${formatMoney(RENT_PRICE)}.`);
    eject(player);
    return;
  }

  const next = account.money - RENT_PRICE;
  patchAccount(player, { money: next });
  const paid = getAccount(player);
  if (!paid) {
    eject(player);
    return;
  }
  applyWallet(player, paid);
  queueSave(player);

  slot.renterUserId = paid.id;
  slot.renterSlotId = slotId;
  slot.seated = true;
  clearLeaveTimer(slot);
  player.sendClientMessage(Color.tryOk, `你已租用礼宾车，花费 ${formatMoney(RENT_PRICE)}。`);
  player.sendClientMessage(Color.gray, "下车后，你有 30 秒时间返回车辆。");
}

function handleLeave(player: Player): void {
  const slot = slotRef.current;
  const account = getAccount(player);
  if (!slot || !account || slot.renterUserId !== account.id || !slot.seated) {
    return;
  }
  if (isDead(player)) {
    endLimoRental(player, "death");
    return;
  }
  if (account.jailSeconds > 0) {
    return;
  }

  slot.seated = false;
  clearLeaveTimer(slot);
  const userId = account.id;
  slot.leaveTimer = setTimeout(() => {
    const live = slotRef.current;
    if (!live || live.renterUserId !== userId || live.seated) {
      return;
    }
    live.leaveTimer = null;
    finishRental();
    notify(userId, "礼宾车租赁已结束：你未及时返回车辆。");
  }, LEAVE_GRACE_MS);

  try {
    player.sendClientMessage(Color.gray, "你有 30 秒时间返回礼宾车。");
  } catch {
    // 玩家已离线。
  }
}

function finishRental(respawnDelayMs = 0): void {
  const slot = slotRef.current;
  if (!slot) {
    return;
  }
  const rented = slot.renterUserId !== null;
  clearLeaveTimer(slot);
  slot.renterUserId = null;
  slot.renterSlotId = null;
  slot.seated = false;
  if (rented) {
    ejectOccupants(slot.vehicleId);
  }
  respawn(slot, respawnDelayMs);
}

function respawn(slot: LimoSlot, delayMs: number): void {
  const run = () => {
    const current = slotRef.current;
    if (!current || current.vehicleId !== slot.vehicleId) {
      return;
    }
    const vehicle = omp.vehicles.at(slot.vehicleId);
    if (!vehicle) {
      return;
    }
    try {
      vehicle.setToRespawn();
    } catch {
      // 已销毁。
    }
  };

  if (delayMs > 0) {
    setTimeout(run, delayMs);
    return;
  }
  run();
}

function ejectOccupants(vehicleId: number): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player)) {
      return;
    }
    try {
      if (!player.isInAnyVehicle() || player.getVehicleID() !== vehicleId) {
        return;
      }
      eject(player);
    } catch {
      // 槽位为空。
    }
  });
}

function isDriverOf(player: Player, vehicleId: number): boolean {
  try {
    return player.getState() === PLAYER_STATE_DRIVER && player.getVehicleID() === vehicleId;
  } catch {
    return false;
  }
}

function isDead(player: Player): boolean {
  try {
    return player.getHealth() <= 0 || player.getState() === PLAYER_STATE_WASTED;
  } catch {
    return true;
  }
}

function eject(player: Player): void {
  const dead = isDead(player);
  try {
    if (!dead) {
      player.clearAnimations(ANIM_SYNC_ALL);
    }
    player.removeFromVehicle();
  } catch {
    // 已不在车辆内。
  }
}

function setControllable(player: Player, enabled: boolean): void {
  try {
    player.toggleControllable(enabled);
  } catch {
    // 槽位为空。
  }
}

function clearLeaveTimer(slot: LimoSlot): void {
  if (slot.leaveTimer) {
    clearTimeout(slot.leaveTimer);
    slot.leaveTimer = null;
  }
}

function notify(userId: number, text: string): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }
    const account = getAccount(player);
    if (account?.id === userId) {
      player.sendClientMessage(Color.error, text);
    }
  });
}

function liveVehicleId(vehicle: Vehicle): number | null {
  try {
    const id = vehicle.getID();
    return id === null || id === undefined ? null : Number(id);
  } catch {
    return null;
  }
}

function vehiclePtr(vehicle: Vehicle): number | null {
  try {
    const ptr = vehicle.getPtr();
    return ptr === null || ptr === undefined ? null : Number(ptr);
  } catch {
    return null;
  }
}
