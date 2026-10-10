import type { Player } from "@omp-node/core";
import { isPlayerActive, playerId } from "../../shared/player";
import { trustPosition } from "../anticheat/trust";
import { isCuffed } from "../cuff";

export type SpawnPoint = {
  x: number;
  y: number;
  z: number;
  angle: number;
  interior: number;
  world: number;
};

export type PlaceAtOptions = {
  /**
   * 传送后的冻结毫秒数(等待碰撞和纹理加载).
   * `false` - 不冻结.默认:interior>0 或不在街道时冻结 2500 毫秒.
   */
  settleMs?: number | false;
};

export const NO_TEAM = 255;

/** 玩家尚无账户时用于职业选择器的皮肤. */
export const DEFAULT_SPAWN_SKIN = 26;

export const STREET_WORLD = 0;

/** 进入室内或自定义 VW 后的等待时间,用于加载物体. */
export const INTERIOR_SETTLE_MS = 2500;

/** 医院专用 VW:其中的玩家和拾取物不会与街道上的对象重叠. */
export const HOSPITAL_WORLD = 1;

/** 监狱专用 VW:天空中的室内空间不会与街道重叠.银行 = 2. */
export const PRISON_WORLD = 3;

/** 监狱院子使用监狱区域坐标:玩家不会与街道重叠. */
export const PRISON_YARD_WORLD = 4;

/** 黑手党(自定义总部,interior 0):LCN VW 14,Yakuza 15,俄罗斯帮派 16 - `org/mafias.ts`. */
/** 帮派(帮派据点):Grove VW 9,Ballas 10,Vagos 11,Rifa 12,Aztecas 13 - `org/gangs.ts`. */
/** 广播中心(自定义室内):VW 8 - `org/radio.ts`. */
/** 市政府(自定义室内):VW 3(= org id)- `org/meriya.ts`.与 PRISON_WORLD 相同,但坐标相距很远. */
/** FBI 总部(自定义室内):VW 6(= org id)- `org/fbi.ts`.与 FBI 军火库 VW 相同,但 interior 不同. */

/** 玩家尚未加入组织时使用的默认出生点. */
export const DEFAULT_SPAWN: SpawnPoint = {
  x: 1760.2538,
  y: -1898.8334,
  z: 13.5629,
  angle: 269.124,
  interior: 0,
  world: STREET_WORLD,
};

export const HOSPITAL_SPAWNS: readonly SpawnPoint[] = [
  {
    x: 1172.5653,
    y: -1344.8042,
    z: 4001.1001,
    angle: 90.5063,
    interior: 0,
    world: HOSPITAL_WORLD,
  },
  {
    x: 1172.564,
    y: -1354.6053,
    z: 4001.1001,
    angle: 89.9031,
    interior: 0,
    world: HOSPITAL_WORLD,
  },
  {
    x: 1165.129,
    y: -1361.8331,
    z: 4001.1001,
    angle: 0.9389,
    interior: 0,
    world: HOSPITAL_WORLD,
  },
  {
    x: 1158.2642,
    y: -1354.5325,
    z: 4001.1001,
    angle: 271.0115,
    interior: 0,
    world: HOSPITAL_WORLD,
  },
  {
    x: 1157.9478,
    y: -1344.7404,
    z: 4001.1001,
    angle: 270.0948,
    interior: 0,
    world: HOSPITAL_WORLD,
  },
];

const settleTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** 当前 settle 会话的令牌(过期计时器不会影响控制状态). */
const settleTokens = new Map<number, object>();

export function pickHospitalSpawn(): SpawnPoint {
  const first = HOSPITAL_SPAWNS[0];
  if (!first) {
    return DEFAULT_SPAWN;
  }

  const index = Math.floor(Math.random() * HOSPITAL_SPAWNS.length);
  return HOSPITAL_SPAWNS[index] ?? first;
}

export function writeSpawnInfo(player: Player, skin: number, point: SpawnPoint): void {
  player.setSpawnInfo(
    NO_TEAM,
    skin,
    point.x,
    point.y,
    point.z,
    point.angle,
    0,
    0,
    0,
    0,
    0,
    0
  );
}

export function placeAt(player: Player, point: SpawnPoint, options?: PlaceAtOptions): void {
  // 解除之前 settle 流程设置的冻结(否则走到街上或再次传送会导致永久锁定).
  clearPlaceAtSettle(player);

  player.setInterior(point.interior);
  player.setVirtualWorld(point.world);
  player.setPos(point.x, point.y, point.z);
  player.setFacingAngle(point.angle);
  player.setCameraBehind();
  trustPosition(player, point.x, point.y, point.z, point.interior, point.world);

  scheduleSettleFreeze(player, resolveSettleMs(point, options));
}

/**
 * 传送后冻结(包括在车辆中;toggleControllable 也会锁定车辆).
 * `settleMs <= 0` - no-op.
 */
export function scheduleSettleFreeze(player: Player, settleMs: number): void {
  if (settleMs <= 0) {
    return;
  }

  const id = playerId(player);
  if (id === null) {
    return;
  }

  clearPlaceAtSettle(player);

  try {
    player.toggleControllable(false);
  } catch {
    return;
  }

  const token = {};
  settleTokens.set(id, token);

  settleTimers.set(
    id,
    setTimeout(() => {
      settleTimers.delete(id);
      if (settleTokens.get(id) !== token) {
        return;
      }
      settleTokens.delete(id);

      try {
        if (isPlayerActive(player) && !isCuffed(player)) {
          player.toggleControllable(true);
        }
      } catch {
        // 玩家已离开.
      }
    }, settleMs)
  );
}

/** 取消延迟解冻(断开连接或再次传送时). */
export function clearPlaceAtSettle(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const hadSettle = settleTimers.has(id) || settleTokens.has(id);

  const timer = settleTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    settleTimers.delete(id);
  }
  settleTokens.delete(id);

  // 只有冻结由此处设置时才解冻(不包括矿井,机器或皮肤选择器设置的冻结).
  if (!hadSettle) {
    return;
  }

  try {
    if (isPlayerActive(player) && !isCuffed(player)) {
      player.toggleControllable(true);
    }
  } catch {
    // 玩家已离开.
  }
}

function resolveSettleMs(point: SpawnPoint, options?: PlaceAtOptions): number {
  if (options?.settleMs === false) {
    return 0;
  }

  if (typeof options?.settleMs === "number") {
    return Math.max(0, options.settleMs);
  }

  // 室内或自定义 VW(医院,监狱,工厂,总部等)需要等待碰撞加载.
  if (point.interior > 0 || point.world !== STREET_WORLD) {
    return INTERIOR_SETTLE_MS;
  }

  return 0;
}
