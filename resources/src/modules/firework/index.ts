import { All, ObjectMp, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { isCuffed } from "../cuff";
import { registerCommand } from "../commands/registry";
import { STREET_WORLD } from "../spawn/point";
import type { GameModule } from "../types";

/** 与示例一致:循环 `0 .. 23` 每轮 24 枚烟花,共 20 轮. */
const PER_WAVE = 24;
const WAVE_COUNT = 20;
const MODEL_BASE = 19121;
const MODEL_VARIANTS = 6;
const EXPLOSION_TYPE = 11;
const EXPLOSION_RADIUS = 0.5;
const DRAW_DISTANCE = 300;
const WAVE_TIMEOUT_MS = 10_000;
const LAUNCH_Z = 2;
/** 放置烟花后等待一段时间,再开始第一轮燃放. */
const FUSE_MS = 5_000;
/** 播放一次 BOM_Plant 后重置;SA-MP 中 time=0 会使动画无限循环. */
const PLANT_MS = 2_200;

const ANIM_SYNC_ALL = 1;
const PLAYER_STATE_ONFOOT = 1;
/** 忽略过早的到达回调:这是 Create/Destroy 的回调残留,并非飞行结束. */
const MIN_FLIGHT_MS = 300;
/** 若烟花未能发射,不应在同一帧内执行完全部 20 轮. */
const FAILED_WAVE_GAP_MS = 1_200;

/** 购买的烟花仅在本次会话内有效,不存入数据库. */
const owned = new Map<number, number>();

type Rocket = {
  object: ObjectMp;
  token: number;
  bornAt: number;
  x: number;
  y: number;
  z: number;
};

let running = false;
let wavesDone = 0;
let waveToken = 0;
let bound = false;
let waveTimer: ReturnType<typeof setTimeout> | null = null;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;
let fuseTimer: ReturnType<typeof setTimeout> | null = null;
let plantTimer: ReturnType<typeof setTimeout> | null = null;
let originX = 0;
let originY = 0;
let originZ = 0;
const pending = new Map<number, Rocket>();

export function getOwnedFireworks(player: Player): number {
  const id = playerId(player);
  if (id === null) {
    return 0;
  }
  return owned.get(id) ?? 0;
}

/** 向本次会话的物品栏增加 N 个烟花. */
export function addOwnedFireworks(player: Player, amount = 1): number {
  const id = playerId(player);
  if (id === null) {
    return 0;
  }

  const add = Math.max(0, Math.floor(amount));
  const next = (owned.get(id) ?? 0) + add;
  owned.set(id, next);
  return next;
}

registerCommand("blow", "燃放烟花", (player) => {
  launchFirework(player);
});

export const fireworkModule: GameModule = {
  name: "firework",
  start() {
    if (bound) {
      return;
    }
    bound = true;

    omp.on("objectMove", (object) => {
      onRocketArrived(object);
    });

    omp.on("playerSpawn", (player) => {
      if (isAuthenticated(player)) {
        preloadPlantAnim(player);
      }
    });

    omp.on("playerDisconnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        owned.delete(id);
      }
    });

    omp.on("playerConnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        owned.delete(id);
      }
    });
  },
};

function launchFirework(player: Player): void {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  if (running) {
    player.sendClientMessage(Color.error, "请稍后重试.");
    return;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  if (account.jailSeconds > 0 || account.hospitalized || isCuffed(player)) {
    player.sendClientMessage(Color.error, "当前无法燃放烟花.");
    return;
  }

  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      player.sendClientMessage(Color.error, "请下车后燃放烟花.");
      return;
    }
    if (player.getInterior() !== 0 || player.getVirtualWorld() !== STREET_WORLD) {
      player.sendClientMessage(Color.error, "请在室外燃放烟花.");
      return;
    }
  } catch {
    return;
  }

  const have = owned.get(slotId) ?? 0;
  if (have < 1) {
    player.sendClientMessage(Color.error, "你没有烟花,请到 24/7 商店购买.");
    return;
  }

  let pos: { x: number; y: number; z: number };
  try {
    pos = player.getPos();
  } catch {
    return;
  }

  owned.set(slotId, have - 1);
  armShow(player, slotId, pos.x, pos.y, pos.z + LAUNCH_Z);
  playPlantAnim(player);

  const left = owned.get(slotId) ?? 0;
  player.sendClientMessage(
    Color.info,
    left > 0
      ? `你已放置烟花,将在 5 秒后燃放.剩余烟花:${left}.`
      : "你已放置烟花,将在 5 秒后燃放."
  );
}

function armShow(player: Player, slotId: number, x: number, y: number, z: number): void {
  stopShow();
  originX = x;
  originY = y;
  originZ = z;
  wavesDone = 0;
  running = true;
  fuseTimer = setTimeout(() => {
    fuseTimer = null;
    if (!running) {
      return;
    }
    if (launchWave()) {
      return;
    }
    running = false;
    if (!isPlayerActive(player) || playerId(player) !== slotId) {
      return;
    }
    owned.set(slotId, (owned.get(slotId) ?? 0) + 1);
    try {
      player.sendClientMessage(Color.error, "无法燃放烟花.");
    } catch {
      // 玩家已离线.
    }
  }, FUSE_MS);
}

function launchWave(): boolean {
  waveToken += 1;
  const token = waveToken;
  destroyPending();

  const stuck: number[] = [];
  for (let i = 0; i < PER_WAVE; i += 1) {
    const targetX = originX - 30 + rand(60);
    const targetY = originY - 30 + rand(60);
    const targetZ = originZ + 30 + rand(20);
    const speed = 35 + rand(15);
    let object: ObjectMp | null = null;
    try {
      object = new ObjectMp(
        MODEL_BASE + rand(MODEL_VARIANTS),
        originX,
        originY,
        originZ,
        0,
        0,
        0,
        DRAW_DISTANCE
      );
      const id = object.getID();
      if (id === null) {
        object.destroy();
        continue;
      }
      pending.set(id, {
        object,
        token,
        bornAt: Date.now(),
        x: targetX,
        y: targetY,
        z: targetZ,
      });
      const moved = object.move(targetX, targetY, targetZ, speed, 0, 0, 0);
      if (!moved) {
        stuck.push(id);
      }
    } catch {
      if (object) {
        const id = objectId(object);
        if (id !== null) {
          pending.delete(id);
        }
        try {
          object.destroy();
        } catch {
          // 已销毁.
        }
      }
    }
  }

  if (pending.size === 0) {
    return false;
  }

  for (const id of stuck) {
    const rocket = pending.get(id);
    if (!rocket) {
      continue;
    }
    pending.delete(id);
    explode(rocket.object, rocket.x, rocket.y, rocket.z);
  }

  if (pending.size === 0) {
    finishWave(token, FAILED_WAVE_GAP_MS);
    return true;
  }

  if (waveTimer) {
    clearTimeout(waveTimer);
  }
  waveTimer = setTimeout(() => finishWave(token), WAVE_TIMEOUT_MS);
  return true;
}

function onRocketArrived(object: ObjectMp): void {
  if (pending.size === 0) {
    return;
  }

  const id = objectId(object);
  if (id === null) {
    return;
  }

  const rocket = pending.get(id);
  if (!rocket || rocket.token !== waveToken) {
    return;
  }
  if (Date.now() - rocket.bornAt < MIN_FLIGHT_MS) {
    return;
  }

  pending.delete(id);
  burst(rocket);
  if (pending.size === 0) {
    finishWave(rocket.token);
  }
}

function finishWave(token: number, gapMs = 0): void {
  if (token !== waveToken) {
    return;
  }

  waveToken += 1;
  const nextToken = waveToken;

  if (waveTimer) {
    clearTimeout(waveTimer);
    waveTimer = null;
  }

  const leftovers = [...pending.values()];
  pending.clear();
  for (const rocket of leftovers) {
    burst(rocket);
  }

  wavesDone += 1;
  if (wavesDone >= WAVE_COUNT) {
    running = false;
    return;
  }

  if (advanceTimer) {
    clearTimeout(advanceTimer);
  }
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    if (!running || waveToken !== nextToken) {
      return;
    }
    if (!launchWave()) {
      running = false;
    }
  }, gapMs);
}

function burst(rocket: Rocket): void {
  let x = rocket.x;
  let y = rocket.y;
  let z = rocket.z;
  try {
    const pos = rocket.object.getPos();
    if (pos.ret && movedAway(pos.x, pos.y, pos.z)) {
      x = pos.x;
      y = pos.y;
      z = pos.z;
    }
  } catch {
    // 在烟花的预定落点生成闪光.
  }

  explode(rocket.object, x, y, z);
}

function explode(object: ObjectMp, x: number, y: number, z: number): void {
  try {
    object.destroy();
  } catch {
    // 已销毁.
  }

  try {
    All.createExplosion(x, y, z, EXPLOSION_TYPE, EXPLOSION_RADIUS);
  } catch {
    // 闪光失败不影响下一枚烟花.
  }
}

function movedAway(x: number, y: number, z: number): boolean {
  const dx = x - originX;
  const dy = y - originY;
  const dz = z - originZ;
  return dx * dx + dy * dy + dz * dz > 4;
}

function stopShow(): void {
  waveToken += 1;
  if (waveTimer) {
    clearTimeout(waveTimer);
    waveTimer = null;
  }
  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }
  if (fuseTimer) {
    clearTimeout(fuseTimer);
    fuseTimer = null;
  }
  if (plantTimer) {
    clearTimeout(plantTimer);
    plantTimer = null;
  }
  destroyPending();
  running = false;
  wavesDone = 0;
}

function destroyPending(): void {
  for (const rocket of pending.values()) {
    try {
      rocket.object.destroy();
    } catch {
      // 已销毁.
    }
  }
  pending.clear();
}

function objectId(object: ObjectMp): number | null {
  try {
    if (!object.isValid()) {
      return null;
    }
    const id = object.getID();
    return id === null ? null : id;
  } catch {
    return null;
  }
}

function preloadPlantAnim(player: Player): void {
  try {
    player.applyAnimation(
      "BOMBER",
      "BOM_Plant",
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
    // 执行 /blow 时会加载动画库.
  }
}

function playPlantAnim(player: Player): void {
  const slotId = playerId(player);
  try {
    player.applyAnimation(
      "BOMBER",
      "BOM_Plant",
      4.1,
      false,
      false,
      false,
      false,
      PLANT_MS,
      ANIM_SYNC_ALL
    );
  } catch {
    // 燃放不依赖动画.
  }

  if (plantTimer) {
    clearTimeout(plantTimer);
  }
  plantTimer = setTimeout(() => {
    plantTimer = null;
    if (slotId === null || !isPlayerActive(player) || playerId(player) !== slotId) {
      return;
    }
    try {
      player.clearAnimations(ANIM_SYNC_ALL);
    } catch {
      // 玩家已切换动画或离线.
    }
  }, PLANT_MS);
}

function rand(max: number): number {
  return Math.floor(Math.random() * max);
}
