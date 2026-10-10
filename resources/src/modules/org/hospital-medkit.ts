import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { isJailed } from "../prison/sentence";
import { HOSPITAL_WORLD } from "../spawn/point";
import {
  addWarehouseMeds,
  getWarehouse,
  takeWarehouseMeds,
} from "../warehouse";
import { ORG_HOSPITAL_ID } from "./hospital";
import {
  HOSPITAL_MEDS_STOCK_POINT,
  refreshHospitalMedsStockLabel,
} from "./hospital-stock";
import { getMembership } from "./membership";

const TICK_MS = 200;
const STOCK_RADIUS = 1.8;
const PLAYER_STATE_ONFOOT = 1;
const DENY_COOLDOWN_MS = 2500;
/** 每次从仓库领取的药品数量. */
export const MEDKIT_TAKE_AMOUNT = 20;
/**
 * 医疗箱的 Attach 索引.槽位 1 被配送箱占用 (`vehicles/hospital` SLOT_BOX).
 */
const SLOT_MEDKIT = 2;
const MEDKIT_MODEL = 11738;
/** 右手. */
const BONE_RIGHT_HAND = 6;

/** 槽位 → 医生持有的药品数量(当前会话). */
const carriedMeds = new Map<number, number>();
/** 槽位 → 是否显示手提医疗箱. */
const hasCase = new Set<number>();
const standingOnStock = new Set<number>();
const denyAt = new Map<number, number>();

/** 领取锁定(箱子配送)由 `vehicles/hospital`. */
let stockBlocked: ((player: Player) => boolean) | null = null;

export function setHospitalMedkitStockBlocked(
  check: ((player: Player) => boolean) | null
): void {
  stockBlocked = check;
}

export function getCarriedHospitalMeds(player: Player): number {
  const id = playerId(player);
  if (id === null) {
    return 0;
  }
  return carriedMeds.get(id) ?? 0;
}

export function hasHospitalMedkitCase(player: Player): boolean {
  const id = playerId(player);
  return id !== null && hasCase.has(id);
}

/** 成功执行 /medhelp 后扣除 1 件药品. */
export function consumeHospitalMed(player: Player): boolean {
  const id = playerId(player);
  if (id === null) {
    return false;
  }

  const have = carriedMeds.get(id) ?? 0;
  if (have < 1) {
    return false;
  }

  const left = have - 1;
  if (left <= 0) {
    carriedMeds.delete(id);
    clearMedkitCase(player);
  } else {
    carriedMeds.set(id, left);
  }
  return true;
}

export function clearMedkitCase(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    hasCase.delete(id);
  }

  try {
    player.removeAttachedObject(SLOT_MEDKIT);
  } catch {
    // 槽位不存在.
  }
}

/** 将药品退回仓库(断开连接 / 解雇). */
export function returnHospitalMedsToStock(player: Player): number {
  const id = playerId(player);
  if (id === null) {
    return 0;
  }

  const amount = carriedMeds.get(id) ?? 0;
  carriedMeds.delete(id);
  standingOnStock.delete(id);
  denyAt.delete(id);
  clearMedkitCase(player);

  if (amount > 0) {
    addWarehouseMeds(ORG_HOSPITAL_ID, amount);
    refreshHospitalMedsStockLabel();
  }

  return amount;
}

export function bindHospitalMedkit(): void {
  setInterval(tickHospitalMedkit, TICK_MS);

  omp.on("playerDeath", (player) => {
    // 移除医疗箱,保留药品.
    clearMedkitCase(player);
    const id = playerId(player);
    if (id !== null) {
      standingOnStock.delete(id);
      denyAt.delete(id);
    }
  });

  omp.on("playerDisconnect", (player) => {
    returnHospitalMedsToStock(player);
  });
}

function tickHospitalMedkit(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const id = playerId(player);
    if (id === null) {
      return;
    }

    // 从医院解雇时,将药品退回仓库.
    if ((carriedMeds.get(id) ?? 0) > 0 && !isHospitalMember(player)) {
      const back = returnHospitalMedsToStock(player);
      if (back > 0) {
        player.sendClientMessage(
          Color.info,
          `药品 (${back} 件) 已归还医院仓库.`
        );
      }
      return;
    }

    // 入狱 / 离开医院室内时,仅移除医疗箱.
    if (hasCase.has(id)) {
      try {
        if (isJailed(player) || player.getVirtualWorld() !== HOSPITAL_WORLD) {
          clearMedkitCase(player);
        }
      } catch {
        clearMedkitCase(player);
      }
    }

    tryTakeMedkitAtStock(player, id);
  });
}

function tryTakeMedkitAtStock(player: Player, id: number): void {
  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      standingOnStock.delete(id);
      return;
    }

    if (player.getVirtualWorld() !== HOSPITAL_MEDS_STOCK_POINT.world) {
      standingOnStock.delete(id);
      return;
    }

    const pos = player.getPos();
    const dist = Math.hypot(
      pos.x - HOSPITAL_MEDS_STOCK_POINT.x,
      pos.y - HOSPITAL_MEDS_STOCK_POINT.y,
      pos.z - HOSPITAL_MEDS_STOCK_POINT.z
    );
    if (dist > STOCK_RADIUS) {
      standingOnStock.delete(id);
      return;
    }

    if (standingOnStock.has(id)) {
      return;
    }

    takeMedkitFromStock(player, id);
  } catch {
    standingOnStock.delete(id);
  }
}

function takeMedkitFromStock(player: Player, id: number): void {
  if (!isHospitalMember(player)) {
    standingOnStock.add(id);
    return;
  }

  if (stockBlocked?.(player)) {
    standingOnStock.add(id);
    return;
  }

  if (hasCase.has(id)) {
    standingOnStock.add(id);
    if (canDeny(id)) {
      player.sendClientMessage(Color.error, "你已经有一套药品.");
    }
    return;
  }

  const have = carriedMeds.get(id) ?? 0;
  if (have > 0) {
    if (!attachMedkitCase(player)) {
      if (canDeny(id)) {
        player.sendClientMessage(Color.error, "无法领取药箱.");
      }
      return;
    }
    standingOnStock.add(id);
    player.sendClientMessage(
      Color.info,
      `你已装备药箱.药品: ${have}. 治疗: /medhelp [id] [金额].`
    );
    return;
  }

  const stock = getWarehouse(ORG_HOSPITAL_ID)?.meds ?? 0;
  if (stock < 1) {
    // 不保持锁定;仓库补货后可在原地领取.
    if (canDeny(id)) {
      player.sendClientMessage(Color.error, "仓库里没有药品.");
    }
    return;
  }

  const take = Math.min(MEDKIT_TAKE_AMOUNT, stock);
  if (!takeWarehouseMeds(ORG_HOSPITAL_ID, take)) {
    if (canDeny(id)) {
      player.sendClientMessage(Color.error, "无法从仓库领取药品.");
    }
    return;
  }

  refreshHospitalMedsStockLabel();

  if (!attachMedkitCase(player)) {
    addWarehouseMeds(ORG_HOSPITAL_ID, take);
    refreshHospitalMedsStockLabel();
    if (canDeny(id)) {
      player.sendClientMessage(Color.error, "无法领取药箱.");
    }
    return;
  }

  carriedMeds.set(id, take);
  standingOnStock.add(id);
  player.sendClientMessage(
    Color.info,
    `你领取了药品套装: ${take} 件.治疗: /medhelp [id] [金额].`
  );
}

function attachMedkitCase(player: Player): boolean {
  clearMedkitCase(player);
  try {
    player.setAttachedObject(
      SLOT_MEDKIT,
      MEDKIT_MODEL,
      BONE_RIGHT_HAND,
      0.286,
      0.086,
      0.066,
      0,
      -105.9,
      0,
      1,
      1,
      1,
      0,
      0
    );
    const id = playerId(player);
    if (id !== null) {
      hasCase.add(id);
    }
    return true;
  } catch {
    return false;
  }
}

function canDeny(id: number): boolean {
  const now = Date.now();
  const last = denyAt.get(id) ?? 0;
  if (now - last < DENY_COOLDOWN_MS) {
    return false;
  }
  denyAt.set(id, now);
  return true;
}

function isHospitalMember(player: Player): boolean {
  const account = getAccount(player);
  const membership = account ? getMembership(account) : null;
  return membership?.org.id === ORG_HOSPITAL_ID;
}
