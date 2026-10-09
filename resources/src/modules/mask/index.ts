import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import type { GameModule } from "../types";

/** 深灰色名称；alpha 为 0 时从雷达上隐藏（SA-MP）。 */
export const MASK_COLOR = 0x2a2a2a00;
export const MASK_DURATION_MS = 10 * 60 * 1000;
export const MASK_DURATION_MINUTES = 10;
const ANIM_SYNC_ALL = 1;
const ANIM_DELAY_MS = 100;

type MaskState = {
  /** 本次佩戴的唯一 ID，用于防止其他计时器或动画影响当前状态。 */
  token: number;
  timer: ReturnType<typeof setTimeout>;
};

/** 已购买的面具仅保存在当前会话（玩家槽位）中，不写入数据库。 */
const owned = new Map<number, number>();
const wearing = new Map<number, MaskState>();
let nextWearToken = 1;

/** 恢复皮肤和颜色（由 org 模块绑定，避免循环导入）。 */
let restoreVisuals: ((player: Player) => void) | null = null;

export function bindMaskVisualRestore(fn: (player: Player) => void): void {
  restoreVisuals = fn;
}

export function getOwnedMasks(player: Player): number {
  const id = playerId(player);
  if (id === null) {
    return 0;
  }

  return owned.get(id) ?? 0;
}

/** 向会话库存中增加 N 个面具。 */
export function addOwnedMasks(player: Player, amount = 1): number {
  const id = playerId(player);
  if (id === null) {
    return 0;
  }

  const add = Math.max(0, Math.floor(amount));
  const next = (owned.get(id) ?? 0) + add;
  owned.set(id, next);
  return next;
}

export function isMasked(player: Player): boolean {
  const id = playerId(player);
  return id !== null && wearing.has(id);
}

export function applyMaskVisuals(player: Player): void {
  try {
    player.setColor(MASK_COLOR);
  } catch {
    // 玩家槽位尚未进入游戏。
  }
}

/** 清除面具状态（标记和计时器）。外观通过 restoreVisuals / applyOrgVisuals 恢复。 */
export function clearMask(player: Player): boolean {
  const id = playerId(player);
  if (id === null) {
    return false;
  }

  const state = wearing.get(id);
  if (!state) {
    return false;
  }

  clearTimeout(state.timer);
  wearing.delete(id);
  return true;
}

/**
 * 佩戴面具：从会话库存扣除 1 个，持续 10 分钟，并从雷达上隐藏。
 * 返回 false 表示无法佩戴（没有面具、已经佩戴、正在服刑等）。
 */
export function wearMask(player: Player): boolean {
  const id = playerId(player);
  const account = getAccount(player);
  if (id === null || !account || wearing.has(id)) {
    return false;
  }

  const have = owned.get(id) ?? 0;
  if (account.hospitalized || account.jailSeconds > 0 || have < 1) {
    return false;
  }

  owned.set(id, have - 1);

  const token = nextWearToken++;
  const timer = setTimeout(() => {
    expireMask(player, id, token);
  }, MASK_DURATION_MS);

  wearing.set(id, { token, timer });
  restoreVisuals?.(player);
  playMaskAnim(player, true, token);
  return true;
}

/** 再次使用 /mask 手动摘下面具。死亡、入狱或计时结束时不播放动画。 */
export function removeMask(player: Player): boolean {
  const id = playerId(player);
  const token = id !== null ? wearing.get(id)?.token : undefined;
  if (!clearMask(player)) {
    return false;
  }

  restoreVisuals?.(player);
  if (token !== undefined) {
    playMaskAnim(player, false, token);
  }
  return true;
}

function preloadMaskAnim(player: Player): void {
  try {
    player.applyAnimation(
      "SHOP",
      "ROB_Shifty",
      4.1,
      false,
      false,
      false,
      false,
      1,
      ANIM_SYNC_ALL
    );
    player.clearAnimations(ANIM_SYNC_ALL);
  } catch {
    // 使用 /mask 时会加载动画。
  }
}

function playMaskAnim(
  player: Player,
  expectMasked: boolean,
  token: number
): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  // restoreVisuals 中的 setSkin 会在同一帧重置动画，因此稍后再播放。
  setTimeout(() => {
    if (playerId(player) !== slotId || !isPlayerActive(player)) {
      return;
    }

    if (expectMasked) {
      if (wearing.get(slotId)?.token !== token) {
        return;
      }
    } else if (wearing.has(slotId)) {
      // 玩家已经重新戴上面具，不播放摘下面具的动画。
      return;
    }

    try {
      player.applyAnimation(
        "SHOP",
        "ROB_Shifty",
        4.1,
        false,
        false,
        false,
        false,
        0,
        ANIM_SYNC_ALL
      );
    } catch {
      // 动画为可选项。
    }
  }, ANIM_DELAY_MS);
}

function clearSession(slotId: number): void {
  const state = wearing.get(slotId);
  if (state) {
    clearTimeout(state.timer);
    wearing.delete(slotId);
  }
  owned.delete(slotId);
}

function expireMask(player: Player, slotId: number, token: number): void {
  const state = wearing.get(slotId);
  if (!state || state.token !== token) {
    return;
  }

  wearing.delete(slotId);

  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  if (playerId(player) !== slotId) {
    return;
  }

  restoreVisuals?.(player);
  try {
    player.sendClientMessage(Color.gray, "面具已摘下: 时间到。");
  } catch {
    // 玩家槽位已清空。
  }
}

export const maskModule: GameModule = {
  name: "mask",
  start() {
    omp.on("playerSpawn", (player) => {
      if (isAuthenticated(player)) {
        preloadMaskAnim(player);
      }
    });

    omp.on("playerDeath", (player) => {
      if (!clearMask(player)) {
        return;
      }

      // 死亡时只移除效果，不播放动画。
      restoreVisuals?.(player);
      if (isPlayerActive(player)) {
        player.sendClientMessage(Color.gray, "面具已摘下。");
      }
    });

    omp.on("playerConnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        clearSession(id);
      }
    });

    omp.on("playerDisconnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        clearSession(id);
      }
    });
  },
};
