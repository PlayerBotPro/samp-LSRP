import { Checkpoint, Dialog, omp, Pickup, TextLabel, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated, patchAccount, applyWallet } from "../auth/session";
import { getExam } from "../autoschool/session";
import { isArmyFactoryOnShift } from "../army-factory";
import { isMinerOnShift } from "../miner";
import { resolvePlayerSkin } from "../org";
import { queueSave } from "../persist";
import { isJailed } from "../prison/sentence";
import type { GameModule } from "../types";
import { STREET_WORLD } from "../spawn/point";
import { DROP_POINT, HIRE_POINT, MAP_ICON_POINT, PICKUP_POINT } from "./points";

export const LOADER_HIRE_DIALOG_ID = 52;
export const LOADER_QUIT_DIALOG_ID = 53;

const PICKUP_MODEL = 1275;
const PICKUP_TYPE = 1;
const PICKUP_RADIUS = 1.6;
const CHECKPOINT_RADIUS = 1.8;
const LABEL_HEIGHT = 0.9;
const LABEL_DRAW_DISTANCE = 18;
const TICK_MS = 200;
const PAY_PER_BAG = 25;
const KEY_JUMP = 32;
const KEY_FIRE = 4;
const PLAYER_STATE_ONFOOT = 1;
const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
const ANIM_SYNC_ALL = 1;
const SPECIAL_ACTION_NONE = 0;
const SPECIAL_ACTION_CARRY = 25;
const SLOT_BAG = 2;
const BAG_MODEL = 2060;
const SKIN_MALE = 260;
const SKIN_FEMALE = 190;
const DIALOG_STYLE_MSGBOX = 0;
const MAP_ICON_SLOT = 4;
const MAP_ICON_TYPE = 51;
const MAPICON_LOCAL = 0;
const ICON_RADIUS = 300;

type Phase = "pickup" | "carry";

type Job = {
  phase: Phase;
  bags: number;
  salary: number;
};

const jobs = new Map<number, Job>();
const standingOnHire = new Set<number>();
const iconShown = new Set<number>();

export function isLoaderOnShift(player: Player): boolean {
  const id = playerId(player);
  if (id === null) {
    return false;
  }

  return jobs.has(id);
}

export function isLoaderCarrying(player: Player): boolean {
  const id = playerId(player);
  if (id === null) {
    return false;
  }

  return jobs.get(id)?.phase === "carry";
}

export const loaderModule: GameModule = {
  name: "loader",
  start() {
    new Pickup(
      PICKUP_MODEL,
      PICKUP_TYPE,
      HIRE_POINT.x,
      HIRE_POINT.y,
      HIRE_POINT.z,
      STREET_WORLD
    );

    new TextLabel(
      "Склад\nРабота грузчика",
      Color.info,
      HIRE_POINT.x,
      HIRE_POINT.y,
      HIRE_POINT.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      STREET_WORLD,
      false
    );

    setInterval(tickLoader, TICK_MS);

    omp.on("playerConnect", (player) => {
      forgetSlot(player);
    });

    omp.on("dialogResponse", (player, dialogId, response) => {
      const id = Number(dialogId);
      const ok = Number(response) !== 0;

      if (id === LOADER_HIRE_DIALOG_ID) {
        if (ok) {
          hire(player);
        }
        return;
      }

      if (id === LOADER_QUIT_DIALOG_ID && ok) {
        finishShift(player);
      }
    });

    omp.on("playerEnterCheckpoint", (player) => {
      onCheckpoint(player);
    });

    omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
      const pressed = newKeys & ~oldKeys;
      if ((pressed & KEY_JUMP) !== 0 || (pressed & KEY_FIRE) !== 0) {
        dropBag(player, "Вы уронили мешок!");
      }
    });

    omp.on("playerStateChange", (player, newState) => {
      if (newState === PLAYER_STATE_DRIVER || newState === PLAYER_STATE_PASSENGER) {
        dropBag(player, "Вы уронили мешок!");
      }
    });

    omp.on("playerDeath", (player) => {
      abortShift(player, true);
    });

    omp.on("playerDisconnect", (player) => {
      hideLoaderIcon(player);
      abortShift(player, false);
      forgetSlot(player);
    });
  },
};

function tickLoader(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const id = playerId(player);
    if (id === null) {
      return;
    }

    const job = jobs.get(id);

    try {
      const pos = player.getPos();
      const world = player.getVirtualWorld();
      const interior = player.getInterior();
      updateLoaderIcon(player, pos.x, pos.y, world, interior);

      if (player.getState() !== PLAYER_STATE_ONFOOT) {
        return;
      }

      if (world !== STREET_WORLD || interior !== 0) {
        standingOnHire.delete(id);
        return;
      }

      const hireDist = Math.hypot(
        pos.x - HIRE_POINT.x,
        pos.y - HIRE_POINT.y,
        pos.z - HIRE_POINT.z
      );
      if (hireDist > PICKUP_RADIUS) {
        standingOnHire.delete(id);
        return;
      }

      if (standingOnHire.has(id)) {
        return;
      }

      standingOnHire.add(id);
      if (job) {
        showQuitDialog(player, job);
      } else {
        showHireDialog(player);
      }
    } catch {
      // Слот уже пуст.
    }
  });
}

function updateLoaderIcon(
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
    Math.hypot(x - MAP_ICON_POINT.x, y - MAP_ICON_POINT.y) <= ICON_RADIUS;

  if (near) {
    if (iconShown.has(id)) {
      return;
    }

    try {
      player.setMapIcon(
        MAP_ICON_SLOT,
        MAP_ICON_POINT.x,
        MAP_ICON_POINT.y,
        MAP_ICON_POINT.z,
        MAP_ICON_TYPE,
        0,
        MAPICON_LOCAL
      );
      iconShown.add(id);
    } catch {
      // Игрок уже вышел.
    }
    return;
  }

  if (!iconShown.has(id)) {
    return;
  }

  hideLoaderIcon(player);
  iconShown.delete(id);
}

function hideLoaderIcon(player: Player): void {
  try {
    player.removeMapIcon(MAP_ICON_SLOT);
  } catch {
    // Игрок уже вышел.
  }
}

function showHireDialog(player: Player): void {
  try {
    Dialog.show(
      player,
      LOADER_HIRE_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "仓库",
      "要应聘搬运工吗？",
      "是",
      "否"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开对话框。");
  }
}

function showQuitDialog(player: Player, job: Job): void {
  try {
    Dialog.show(
      player,
      LOADER_QUIT_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "仓库",
      `要结束工作并领取工资吗？\n已搬运袋数：${job.bags}，工资：$${job.salary}`,
      "是",
      "否"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开对话框。");
  }
}

function hire(player: Player): void {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const id = playerId(player);
  const account = getAccount(player);
  if (id === null || !account) {
    return;
  }

  if (account.hospitalized) {
    player.sendClientMessage(Color.error, "请先完成治疗。");
    return;
  }

  if (isJailed(player)) {
    player.sendClientMessage(Color.error, "不能在监狱里工作。");
    return;
  }

  if (isMinerOnShift(player)) {
    player.sendClientMessage(Color.error, "请先结束矿工班次。");
    return;
  }

  if (isArmyFactoryOnShift(player)) {
    player.sendClientMessage(Color.error, "请先结束弹药车间班次。");
    return;
  }

  if (getExam(player)) {
    player.sendClientMessage(Color.error, "请先完成驾校考试。");
    return;
  }

  if (!isOnFootAt(player, HIRE_POINT, PICKUP_RADIUS + 0.8)) {
    player.sendClientMessage(Color.error, "请靠近工作地点。");
    return;
  }

  if (jobs.has(id)) {
    return;
  }

  const skin = account.gender === "female" ? SKIN_FEMALE : SKIN_MALE;
  const job: Job = {
    phase: "pickup",
    bags: 0,
    salary: 0,
  };
  jobs.set(id, job);

  try {
    player.setSkin(skin);
    preloadAnims(player);
  } catch {
    abortShift(player, false);
    return;
  }

  setPickupCheckpoint(player);
  player.sendClientMessage(
    Color.info,
    "工作日已开始。把装载区的麻袋送到仓库 — 标记点已显示在雷达上。"
  );
}

function finishShift(player: Player): void {
  const id = playerId(player);
  const account = getAccount(player);
  const job = id !== null ? jobs.get(id) : undefined;
  if (id === null || !account || !job) {
    return;
  }

  if (!isOnFootAt(player, HIRE_POINT, PICKUP_RADIUS + 0.8)) {
    player.sendClientMessage(Color.error, "请靠近工作地点。");
    return;
  }

  const bags = job.bags;
  const salary = job.salary;
  restoreWorker(player, resolvePlayerSkin(account));
  jobs.delete(id);

  if (salary > 0) {
    patchAccount(player, { money: account.money + salary });
    const updated = getAccount(player);
    if (updated) {
      applyWallet(player, updated);
    }
    queueSave(player);
  }

  player.sendClientMessage(
    Color.info,
    `班次结束。麻袋: ${bags}. 工资: $${salary}.`
  );
}

function abortShift(player: Player, notify: boolean): void {
  const id = playerId(player);
  if (id === null || !jobs.has(id)) {
    return;
  }

  const account = getAccount(player);
  restoreWorker(player, account ? resolvePlayerSkin(account) : null);
  jobs.delete(id);

  if (notify && isPlayerActive(player)) {
    player.sendClientMessage(
      Color.error,
      "班次中断。未发放的工资已作废。"
    );
  }
}

function restoreWorker(player: Player, skin: number | null): void {
  try {
    clearBag(player);
    Checkpoint.disable(player);
    if (skin !== null) {
      player.setSkin(skin);
    }
  } catch {
    // Игрок уже вышел.
  }
}

function onCheckpoint(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const job = jobs.get(id);
  if (!job) {
    return;
  }

  if (job.phase === "pickup") {
    takeBag(player, job);
    return;
  }

  if (job.phase === "carry") {
    deliverBag(player, job);
  }
}

function takeBag(player: Player, job: Job): void {
  if (job.phase !== "pickup") {
    return;
  }

  if (!isOnFootAt(player, PICKUP_POINT, CHECKPOINT_RADIUS + 2)) {
    return;
  }

  try {
    giveBag(player);
    Checkpoint.set(player, DROP_POINT.x, DROP_POINT.y, DROP_POINT.z, CHECKPOINT_RADIUS);
  } catch {
    clearBag(player);
    setPickupCheckpoint(player);
    player.sendClientMessage(Color.error, "无法拿起麻袋。请重试。");
    return;
  }

  job.phase = "carry";
  player.sendClientMessage(Color.info, "你拿着麻袋。把它送到卸货点。");
}

function deliverBag(player: Player, job: Job): void {
  if (job.phase !== "carry") {
    return;
  }

  if (!isOnFootAt(player, DROP_POINT, CHECKPOINT_RADIUS + 2)) {
    return;
  }

  job.phase = "pickup";
  job.bags += 1;
  job.salary += PAY_PER_BAG;

  try {
    clearBag(player);
    playTiredAnim(player);
    setPickupCheckpoint(player);
  } catch {
    abortShift(player, true);
    return;
  }

  player.sendClientMessage(
    Color.info,
    `已搬运麻袋: ${job.bags}. +$${PAY_PER_BAG}`
  );
  player.sendClientMessage(Color.white, `本班工资: $${job.salary}`);
}

function dropBag(player: Player, message: string): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const job = jobs.get(id);
  if (!job || job.phase !== "carry") {
    return;
  }

  job.phase = "pickup";

  try {
    clearBag(player);
    playTiredAnim(player);
    setPickupCheckpoint(player);
  } catch {
    // Игрок уже вышел.
  }

  player.sendClientMessage(Color.error, message);
}

function setPickupCheckpoint(player: Player): void {
  try {
    Checkpoint.set(player, PICKUP_POINT.x, PICKUP_POINT.y, PICKUP_POINT.z, CHECKPOINT_RADIUS);
  } catch {
    // Игрок уже вышел.
  }
}

function giveBag(player: Player): void {
  clearBag(player);
  player.setAttachedObject(
    SLOT_BAG,
    BAG_MODEL,
    5,
    0.01,
    0.1,
    0.2,
    100,
    10,
    85,
    1,
    1,
    1,
    0,
    0
  );
  player.setSpecialAction(SPECIAL_ACTION_CARRY);
}

function clearBag(player: Player): void {
  try {
    player.removeAttachedObject(SLOT_BAG);
  } catch {
    // Слота не было.
  }

  try {
    player.setSpecialAction(SPECIAL_ACTION_NONE);
    player.clearAnimations(ANIM_SYNC_ALL);
  } catch {
    // Игрок уже вышел.
  }
}

function playTiredAnim(player: Player): void {
  try {
    player.applyAnimation(
      "PED",
      "IDLE_tired",
      4.1,
      false,
      true,
      true,
      false,
      1,
      ANIM_SYNC_ALL
    );
  } catch {
    // Библиотека подтянется позже.
  }
}

function preloadAnims(player: Player): void {
  try {
    player.applyAnimation("PED", "IDLE_tired", 4.1, false, false, false, false, 1, ANIM_SYNC_ALL);
    player.clearAnimations(ANIM_SYNC_ALL);
  } catch {
    // Библиотека подтянется при первой разгрузке.
  }
}

function isOnFootAt(
  player: Player,
  point: { x: number; y: number; z: number },
  radius: number
): boolean {
  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      return false;
    }

    if (player.getVirtualWorld() !== STREET_WORLD || player.getInterior() !== 0) {
      return false;
    }

    const pos = player.getPos();
    return Math.hypot(pos.x - point.x, pos.y - point.y, pos.z - point.z) <= radius;
  } catch {
    return false;
  }
}

function forgetSlot(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  jobs.delete(id);
  standingOnHire.delete(id);
  iconShown.delete(id);
}
