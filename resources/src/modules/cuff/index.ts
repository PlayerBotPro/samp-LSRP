import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import {
  saveUserHospitalized,
  saveUserJailedSeconds,
} from "../auth/repository";
import {
  MAX_HEALTH,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { clearWantedDecay, setPlayerWantedLevel } from "../auth/wanted";
import type { GameModule } from "../types";

const ANIM_SYNC_ALL = 1;
const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
/** 最高拘留时长(对应 6 星通缉;/arrest 或自首):6 × 10 分钟. */
const ESCAPE_JAIL_MINUTES = 60;

/** 警员手铐状态的会话标记(按玩家槽位记录). */
const cuffed = new Set<number>();

export function isCuffed(player: Player): boolean {
  const id = playerId(player);
  return id !== null && cuffed.has(id);
}

function setControllable(player: Player, enabled: boolean): void {
  try {
    player.toggleControllable(enabled);
  } catch {
    // 槽位为空.
  }
}

function leaveVehicle(player: Player): void {
  try {
    if (player.isInAnyVehicle()) {
      player.removeFromVehicle();
    }
  } catch {
    // 已经下车.
  }
}

function applyCuffAnim(player: Player): void {
  try {
    // SA-MP:第一次调用会加载动画库,第二次调用才会播放动画.
    player.applyAnimation("ped", "cpr_loop", 4.1, false, false, false, true, 0, ANIM_SYNC_ALL);
    player.applyAnimation("ped", "cpr_loop", 4.1, false, false, false, true, 0, ANIM_SYNC_ALL);
  } catch {
    // 槽位为空.
  }
}

function clearCuffAnim(player: Player): void {
  try {
    player.clearAnimations(ANIM_SYNC_ALL);
  } catch {
    // 槽位为空.
  }
}

/** 给玩家戴上手铐:让其下车,冻结并播放动画. */
export function applyCuff(player: Player): boolean {
  const id = playerId(player);
  if (id === null || !isPlayerActive(player) || cuffed.has(id)) {
    return false;
  }

  leaveVehicle(player);
  cuffed.add(id);
  setControllable(player, false);
  applyCuffAnim(player);
  return true;
}

/** 解开手铐并恢复控制(玩家仍在该槽位时). */
export function clearCuff(player: Player): boolean {
  const id = playerId(player);
  if (id === null || !cuffed.has(id)) {
    return false;
  }

  cuffed.delete(id);

  if (!isPlayerActive(player) || playerId(player) !== id) {
    return true;
  }

  clearCuffAnim(player);
  setControllable(player, true);
  return true;
}

/** 如果手铐标记仍存在,则重新冻结玩家(例如传送后). */
export function refreshCuffFreeze(player: Player): void {
  if (!isCuffed(player)) {
    return;
  }

  setControllable(player, false);

  try {
    // SA-MP 有时会因载具状态清除动画,因此在车外重新播放.
    if (!player.isInAnyVehicle()) {
      applyCuffAnim(player);
    }
  } catch {
    applyCuffAnim(player);
  }
}

/** 调用 PutPlayerInVehicle 前暂时解除冻结(保留手铐标记). */
export function releaseCuffForVehiclePut(player: Player): void {
  if (!isCuffed(player)) {
    return;
  }

  setControllable(player, true);
}

/** 玩家上车后重新冻结. */
export function scheduleCuffRefreeze(player: Player, delayMs = 1000): void {
  const id = playerId(player);
  if (id === null || !cuffed.has(id)) {
    return;
  }

  setTimeout(() => {
    if (!isPlayerActive(player) || playerId(player) !== id || !cuffed.has(id)) {
      return;
    }

    refreshCuffFreeze(player);
  }, delayMs);
}

function clearSlot(slotId: number): void {
  cuffed.delete(slotId);
}

function broadcastAll(color: number, text: string): void {
  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      other.sendClientMessage(color, text);
    } catch {
      // 槽位为空.
    }
  });
}

/**
 * 玩家戴着手铐时退出:在数据库中设置最高监禁时长,并向所有玩家广播.
 * disconnect 时调用,避免监禁时长被持久化队列覆盖为零.
 */
export function applyCuffDisconnectJail(player: Player): void {
  const slotId = playerId(player);
  if (slotId === null || !cuffed.has(slotId)) {
    return;
  }

  // 立即清除标记,避免重复触发 disconnect 处理逻辑.
  cuffed.delete(slotId);

  if (!isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  const seconds = ESCAPE_JAIL_MINUTES * 60;
  const name = account.name || playerName(player);

  patchAccount(player, {
    jailSeconds: seconds,
    hospitalized: false,
    health: MAX_HEALTH,
  });

  if (account.wantedLevel > 0) {
    setPlayerWantedLevel(player, 0);
  } else {
    clearWantedDecay(player);
  }

  broadcastAll(
    Color.error,
    `玩家 ${name} 在被捕时退出,已被送入监狱.`
  );

  const userId = account.id;
  void saveUserJailedSeconds(userId, seconds).catch(() => {
    // 持久化队列会从缓存重试保存 jail_seconds.
  });
  void saveUserHospitalized(userId, false, MAX_HEALTH).catch(() => {
    // 保存失败不会影响玩家重生.
  });
}

export const cuffModule: GameModule = {
  name: "cuff",
  start() {
    // 死亡时不要清除手铐标记,否则玩家可借 Wasted 状态逃避监禁.
    // 在 spawn(医院),applyJail,解铐或 disconnect 罚则时清除标记.

    omp.on("playerConnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        clearSlot(id);
      }
    });

    omp.on("playerDisconnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        clearSlot(id);
      }
    });

    omp.on("playerSpawn", (player) => {
      // 死亡或重生后解开手铐.标记需保留到 spawn,以便处理 Wasted 状态下的退出监禁.
      if (isCuffed(player)) {
        clearCuff(player);
      }
    });

    omp.on("playerStateChange", (player, newState) => {
      if (!isCuffed(player)) {
        return;
      }

      const state = Number(newState);

      // 戴着手铐时禁止坐驾驶位.
      if (state === PLAYER_STATE_DRIVER) {
        leaveVehicle(player);
        refreshCuffFreeze(player);
        return;
      }

      // 作为乘客(/putpl)时允许留在车内,只冻结玩家,不播放动画.
      if (state === PLAYER_STATE_PASSENGER) {
        setControllable(player, false);
      }
    });
  },
};
