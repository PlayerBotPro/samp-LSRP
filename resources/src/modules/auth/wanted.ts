import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { saveUserWantedLevel } from "./repository";
import {
  applyWantedLevel,
  getAccount,
  isAuthenticated,
  normalizeWantedLevel,
  patchAccount,
} from "./session";

const DECAY_MS = 20 * 60 * 1000;
const TICK_MS = 5000;

/** 玩家槽位 → 下次降低一级通缉的时间（仅在线时）。 */
const nextDecayAt = new Map<number, number>();

type WantedClearedHook = (accountId: number, slot: number | null) => void;

let onWantedCleared: WantedClearedHook | null = null;

/** 订阅 `/wanted` 追踪：通缉清零时取消检查点。 */
export function setWantedClearedHook(hook: WantedClearedHook | null): void {
  onWantedCleared = hook;
}

/** 设置 0–6 级通缉：同步缓存、游戏星级和数据库。 */
export function setPlayerWantedLevel(player: Player, level: number): void {
  const wanted = normalizeWantedLevel(level);
  const account = getAccount(player);
  if (!account) {
    return;
  }

  const prev = account.wantedLevel;
  patchAccount(player, { wantedLevel: wanted });
  applyWantedLevel(player, wanted);
  void saveUserWantedLevel(account.id, wanted).catch(() => {
    // 缓存和客户端已更新。
  });
  syncWantedDecay(player);

  if (prev > 0 && wanted === 0) {
    try {
      onWantedCleared?.(account.id, playerId(player));
    } catch {
      // 追踪钩子的错误不应影响解除通缉。
    }
  }
}

/**
 * 启动或停止通缉等级下降计时器。
 * 不重置正在进行的倒计时（避免 /su 重置 20 分钟计时）。
 */
export function syncWantedDecay(player: Player): void {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return;
  }

  if (account.wantedLevel <= 0) {
    nextDecayAt.delete(slot);
    return;
  }

  if (!nextDecayAt.has(slot)) {
    nextDecayAt.set(slot, Date.now() + DECAY_MS);
  }
}

export function clearWantedDecay(player: Player): void {
  const slot = playerId(player);
  if (slot !== null) {
    nextDecayAt.delete(slot);
  }
}

export function bindWantedDecay(): void {
  setInterval(tickWantedDecay, TICK_MS);

  omp.on("playerDisconnect", (player) => {
    clearWantedDecay(player);
  });
}

function tickWantedDecay(): void {
  const now = Date.now();

  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const slot = playerId(player);
    if (slot === null) {
      return;
    }

    const due = nextDecayAt.get(slot);
    if (due === undefined || now < due) {
      return;
    }

    const account = getAccount(player);
    if (!account || account.wantedLevel <= 0) {
      nextDecayAt.delete(slot);
      return;
    }

    let next = account.wantedLevel;
    let cursor = due;
    while (next > 0 && now >= cursor) {
      next -= 1;
      cursor += DECAY_MS;
    }

    const dropped = account.wantedLevel - next;
    if (dropped <= 0) {
      nextDecayAt.set(slot, now + DECAY_MS);
      return;
    }

    // syncWantedDecay 会设为当前时间加 20 分钟；下方会校正补算时的剩余时间。
    nextDecayAt.delete(slot);
    setPlayerWantedLevel(player, next);
    if (next > 0) {
      nextDecayAt.set(slot, cursor);
    }

    try {
      if (next > 0) {
        player.sendClientMessage(
          Color.info,
          dropped === 1
            ? `通缉等级已降低: ${next}.`
            : `通缉等级已降低: ${next} (-${dropped}).`
        );
      } else {
        player.sendClientMessage(Color.info, "通缉已解除: 时效已过。");
      }
    } catch {
      // 玩家已离线。
    }
  });
}
