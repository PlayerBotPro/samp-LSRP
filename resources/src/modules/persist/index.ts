import { omp, type Player } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { saveUserHealth, saveUserHunger, saveUserJailedSeconds, saveUserVitals } from "../auth/repository";
import { trustHealth } from "../anticheat/trust";
import {
  HEALTH_DECAY_AMOUNT,
  HEALTH_DECAY_MS,
  HUNGER_DECAY_AMOUNT,
  HUNGER_WARN_LEVELS,
  MAX_HEALTH,
  MIN_HEALTH,
  VITALS_SAVE_MS,
  applyWallet,
  getAccount,
  isAuthenticated,
  normalizeHunger,
  patchAccount,
} from "../auth/session";
import { applyCuffDisconnectJail } from "../cuff";
import { isSafeZoneDamage } from "../zones/safe";
import { isBankBusy } from "../bank/tellers";
import type { GameModule } from "../types";

const PLAYER_STATE_ONFOOT = 1;
const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
const PLAYER_STATE_WASTED = 7;
const PLAYER_STATE_SPECTATING = 9;

const HUNGER_WARN_TEXT: Record<(typeof HUNGER_WARN_LEVELS)[number], string> = {
  40: "你开始饿了.",
  30: "你已经很饿了.",
  20: "你饿极了.快去找些食物.",
};

/** 已向玩家显示过哪些饥饿阈值(避免重复刷屏). */
const hungerWarned = new Map<number, Set<number>>();

function isInWorld(player: Player): boolean {
  try {
    const state = player.getState();
    return (
      state === PLAYER_STATE_ONFOOT ||
      state === PLAYER_STATE_DRIVER ||
      state === PLAYER_STATE_PASSENGER
    );
  } catch {
    return false;
  }
}

function readLiveHealth(player: Player, fallback: number): number {
  try {
    const state = player.getState();
    if (state === PLAYER_STATE_WASTED || state === PLAYER_STATE_SPECTATING) {
      return fallback;
    }

    const health = player.getHealth();
    if (health > 0) {
      return Math.min(MAX_HEALTH, health);
    }
  } catch {
    // 观战,死亡或退出时,使用账户中最后保存的状态.
  }

  return fallback;
}

function persistJailSeconds(userId: number, seconds: number, name: string): void {
  void saveUserJailedSeconds(userId, seconds).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] 无法保存 ${name} 的刑期:${message}`);
  });
}

export function queueSave(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  persistJailSeconds(account.id, account.jailSeconds, account.name);

  const health = readLiveHealth(player, account.health);
  const hunger = normalizeHunger(account.hunger);

  if (isBankBusy(player)) {
    patchAccount(player, { health, hunger });
    void saveUserHealth(account.id, health).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      omp.log(`[${SERVER_TAG}] 无法保存 ${account.name} 的生命值:${message}`);
    });
    void saveUserHunger(account.id, hunger).catch(() => {
      // 定期保存会处理此状态.
    });
    return;
  }
  const money = Math.max(0, Math.floor(account.money));
  const bank = Math.max(0, Math.floor(account.bank));
  patchAccount(player, { health, money, bank, hunger });

  if (isInWorld(player)) {
    applyWallet(player, { ...account, money });
  }

  void saveUserVitals(account.id, health, money, bank, hunger).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] 无法保存角色 ${account.name}:${message}`);
  });
}

function rememberHealth(player: Player): void {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  const health = readLiveHealth(player, account.health);
  if (health !== account.health) {
    patchAccount(player, { health });
  }
}

function warnHungerIfNeeded(player: Player, prev: number, next: number): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  let shown = hungerWarned.get(slotId);
  if (!shown) {
    shown = new Set();
    hungerWarned.set(slotId, shown);
  }

  for (const level of HUNGER_WARN_LEVELS) {
    if (prev > level && next <= level && !shown.has(level)) {
      shown.add(level);
      player.sendClientMessage(Color.error, HUNGER_WARN_TEXT[level]);
    }
  }

  // 进食后,下次饥饿值下降时可以再次提醒.
  for (const level of HUNGER_WARN_LEVELS) {
    if (next > level) {
      shown.delete(level);
    }
  }
}

/** 进食或恢复后重置饥饿提醒. */
export function notifyHungerRestored(player: Player, hunger: number): void {
  const slotId = playerId(player);
  if (slotId === null) {
    return;
  }

  const shown = hungerWarned.get(slotId);
  if (!shown) {
    return;
  }

  const level = normalizeHunger(hunger);
  for (const warn of HUNGER_WARN_LEVELS) {
    if (level > warn) {
      shown.delete(warn);
    }
  }
}

/** 饥饿值始终会下降;只有饥饿值为 0 时才会扣除生命值. */
function decayVitals(player: Player): void {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  try {
    if (account.hospitalized) {
      return;
    }

    if (!player.isSpawned() || player.getState() === PLAYER_STATE_WASTED) {
      return;
    }

    const prevHunger = normalizeHunger(account.hunger);

    if (prevHunger > 0) {
      const nextHunger = Math.max(0, prevHunger - HUNGER_DECAY_AMOUNT);
      patchAccount(player, { hunger: nextHunger });
      warnHungerIfNeeded(player, prevHunger, nextHunger);
      queueSave(player);

      if (nextHunger > 0) {
        return;
      }
      // 本次刚降到 0;暂不扣除生命值,从下一次开始.
      return;
    }

    const live = player.getHealth();
    if (live <= MIN_HEALTH) {
      return;
    }

    const next = Math.max(MIN_HEALTH, live - HEALTH_DECAY_AMOUNT);
    player.setHealth(next);
    trustHealth(player, next);
    patchAccount(player, { health: next });
    queueSave(player);
  } catch {
    // 玩家已离开.
  }
}

export const persistModule: GameModule = {
  name: "persist",
  start() {
    omp.on("playerTakeDamage", (player, from, amount) => {
      if (isSafeZoneDamage(player, from)) {
        return;
      }
      const account = getAccount(player);
      if (account) {
        try {
          const after = Math.min(
            MAX_HEALTH,
            Math.max(0, player.getHealth() - Number(amount))
          );
          if (after > 0) {
            patchAccount(player, { health: after });
          }
        } catch {
          // 槽位已失效.
        }
      }

      setTimeout(() => {
        rememberHealth(player);
      }, 50);
    });

    omp.on("playerDisconnect", (player) => {
      const slotId = playerId(player);
      if (slotId !== null) {
        hungerWarned.delete(slotId);
      }
      // 必须先于 queueSave 执行,否则数据库会写入 jail_seconds=0,退出惩罚就会丢失.
      applyCuffDisconnectJail(player);
      queueSave(player);
    });

    setInterval(() => {
      omp.players.forEach((player) => {
        if (isAuthenticated(player)) {
          queueSave(player);
        }
      });
    }, VITALS_SAVE_MS);

    setInterval(() => {
      omp.players.forEach(decayVitals);
    }, HEALTH_DECAY_MS);
  },
};
