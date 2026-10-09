import {
  Dialog,
  ObjectMp,
  omp,
  Pickup,
  TextLabel,
  type Player,
} from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated, patchAccount, applyWallet } from "../auth/session";
import { getExam } from "../autoschool/session";
import { isLoaderOnShift } from "../loader";
import { isMinerOnShift } from "../miner";
import { resolvePlayerSkin, ORG_ARMY_ID } from "../org";
import { getMembership } from "../org/membership";
import { refreshArmyAmmoStockLabel } from "../org/army-locker";
import { queueSave } from "../persist";
import { isJailed } from "../prison/sentence";
import type { GameModule } from "../types";
import { addWarehouseAmmo } from "../warehouse";
import {
  ARMY_FACTORY_INTERIOR,
  ARMY_FACTORY_WORLD,
  BENCH_POINTS,
  BLANK_POINTS,
  HIRE_POINT,
  STOCK_POINTS,
} from "./points";

export const ARMY_FACTORY_HIRE_DIALOG_ID = 60;
export const ARMY_FACTORY_QUIT_DIALOG_ID = 61;

const PICKUP_TYPE = 1;
const HIRE_PICKUP_MODEL = 1275;
const BLANK_PICKUP_MODEL = 19135;
const BENCH_PICKUP_MODEL = 18635;
const STOCK_PICKUP_MODEL = 1575;
const BLANK_ATTACH_MODEL = 1575;
const TOOL_ATTACH_MODEL = 18635;
const PRODUCT_MODEL = 1790;
const PICKUP_RADIUS = 1.45;
const LABEL_HEIGHT = 0.85;
const LABEL_DRAW_DISTANCE = 14;
const TICK_MS = 200;
const PLAYER_STATE_ONFOOT = 1;
const ANIM_SYNC_ALL = 1;
const SPECIAL_ACTION_NONE = 0;
const SPECIAL_ACTION_CARRY = 25;
const SLOT_HAND = 1;
const SKIN_MALE = 260;
const SKIN_FEMALE = 190;
const DIALOG_STYLE_MSGBOX = 0;
const CRAFT_MS = 20_000;
const PAY_PER_BOX = 30;
const FINE_PER_DEFECT = 15;
const AMMO_PER_BOX = 40;
const CRAFT_SUCCESS_CHANCE = 0.7;
const OBJECT_DRAW = 80;

type Phase = "idle" | "blank" | "craft" | "product";

type Job = {
  phase: Phase;
  delivered: number;
  defects: number;
  craftObject: ObjectMp | null;
  craftTimer: ReturnType<typeof setTimeout> | null;
};

const jobs = new Map<number, Job>();
const standing = new Map<number, string>();

export function isArmyFactoryOnShift(player: Player): boolean {
  const id = playerId(player);
  return id !== null && jobs.has(id);
}

/** 结束工作班次并发放工资（离开工厂 / 更衣室）。 */
export function endArmyFactoryShift(player: Player): void {
  finishShift(player, { requireHirePoint: false, notifyExit: true });
}

export const armyFactoryModule: GameModule = {
  name: "army-factory",
  start() {
    spawnPickups();

    setInterval(tickFactory, TICK_MS);

    omp.on("playerConnect", (player) => {
      forgetSlot(player);
    });

    omp.on("dialogResponse", (player, dialogId, response) => {
      const id = Number(dialogId);
      const ok = Number(response) !== 0;

      if (id === ARMY_FACTORY_HIRE_DIALOG_ID) {
        if (ok) {
          hire(player);
        }
        return;
      }

      if (id === ARMY_FACTORY_QUIT_DIALOG_ID && ok) {
        finishShift(player, { requireHirePoint: true, notifyExit: false });
      }
    });

    omp.on("playerDeath", (player) => {
      abortShift(player, true);
    });

    omp.on("playerDisconnect", (player) => {
      abortShift(player, false);
      forgetSlot(player);
    });
  },
};

function spawnPickups(): void {
  new Pickup(
    HIRE_PICKUP_MODEL,
    PICKUP_TYPE,
    HIRE_POINT.x,
    HIRE_POINT.y,
    HIRE_POINT.z,
    ARMY_FACTORY_WORLD
  );
  new TextLabel(
    "弹药车间\n更衣室",
    Color.info,
    HIRE_POINT.x,
    HIRE_POINT.y,
    HIRE_POINT.z + LABEL_HEIGHT,
    LABEL_DRAW_DISTANCE,
    ARMY_FACTORY_WORLD,
    false
  );

  for (const point of BLANK_POINTS) {
    new Pickup(
      BLANK_PICKUP_MODEL,
      PICKUP_TYPE,
      point.x,
      point.y,
      point.z,
      ARMY_FACTORY_WORLD
    );
    new TextLabel(
      "弹药毛坯\n弹壳",
      Color.info,
      point.x,
      point.y,
      point.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      ARMY_FACTORY_WORLD,
      false
    );
  }

  for (const bench of BENCH_POINTS) {
    new Pickup(
      BENCH_PICKUP_MODEL,
      PICKUP_TYPE,
      bench.pickup.x,
      bench.pickup.y,
      bench.pickup.z,
      ARMY_FACTORY_WORLD
    );
    new TextLabel(
      "机器\n组装子弹",
      Color.info,
      bench.pickup.x,
      bench.pickup.y,
      bench.pickup.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      ARMY_FACTORY_WORLD,
      false
    );
  }

  for (const point of STOCK_POINTS) {
    new Pickup(
      STOCK_PICKUP_MODEL,
      PICKUP_TYPE,
      point.x,
      point.y,
      point.z,
      ARMY_FACTORY_WORLD
    );
    new TextLabel(
      "仓库\n成品子弹",
      Color.info,
      point.x,
      point.y,
      point.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      ARMY_FACTORY_WORLD,
      false
    );
  }
}

function tickFactory(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const id = playerId(player);
    if (id === null) {
      return;
    }

    try {
      const job = jobs.get(id);
      const world = player.getVirtualWorld();
      const interior = player.getInterior();
      const inFactory =
        world === ARMY_FACTORY_WORLD && interior === ARMY_FACTORY_INTERIOR;

      // /goto、/tpint 等命令：离开车间后不应继续保留工作班次。
      if (job && !inFactory) {
        endArmyFactoryShift(player);
        standing.delete(id);
        return;
      }

      if (!inFactory) {
        standing.delete(id);
        return;
      }

      if (player.getState() !== PLAYER_STATE_ONFOOT) {
        standing.delete(id);
        return;
      }

      if (job?.phase === "craft") {
        return;
      }

      const pos = player.getPos();
      const zone = resolveZone(pos);
      if (!zone) {
        standing.delete(id);
        return;
      }

      if (standing.get(id) === zone.key) {
        return;
      }

      standing.set(id, zone.key);

      switch (zone.kind) {
        case "hire":
          onHirePickup(player, job);
          break;
        case "blank":
          onBlankPickup(player, job);
          break;
        case "bench":
          onBenchPickup(player, job, zone.index);
          break;
        case "stock":
          onStockPickup(player, job);
          break;
      }
    } catch {
      // 槽位为空。
    }
  });
}

function resolveZone(pos: {
  x: number;
  y: number;
  z: number;
}):
  | { kind: "hire"; key: string }
  | { kind: "blank"; key: string; index: number }
  | { kind: "bench"; key: string; index: number }
  | { kind: "stock"; key: string; index: number }
  | null {
  if (near(pos, HIRE_POINT)) {
    return { kind: "hire", key: "hire" };
  }

  for (let i = 0; i < BLANK_POINTS.length; i++) {
    if (near(pos, BLANK_POINTS[i]!)) {
      return { kind: "blank", key: `blank:${i}`, index: i };
    }
  }

  for (let i = 0; i < BENCH_POINTS.length; i++) {
    if (near(pos, BENCH_POINTS[i]!.pickup)) {
      return { kind: "bench", key: `bench:${i}`, index: i };
    }
  }

  for (let i = 0; i < STOCK_POINTS.length; i++) {
    if (near(pos, STOCK_POINTS[i]!)) {
      return { kind: "stock", key: `stock:${i}`, index: i };
    }
  }

  return null;
}

function onHirePickup(player: Player, job: Job | undefined): void {
  if (job) {
    showQuitDialog(player, job);
    return;
  }

  const account = getAccount(player);
  const membership = account ? getMembership(account) : null;
  if (membership?.org.id !== ORG_ARMY_ID) {
    player.sendClientMessage(Color.error, "军队员工才能在车间工作。");
    return;
  }

  showHireDialog(player);
}

function onBlankPickup(player: Player, job: Job | undefined): void {
  if (!job) {
    player.sendClientMessage(Color.error, "请先在更衣室开始工作。");
    return;
  }

  if (job.phase === "blank") {
    player.sendClientMessage(Color.error, "你已经有一份弹壳毛坯。");
    return;
  }

  if (job.phase !== "idle") {
    player.sendClientMessage(
      Color.error,
      job.phase === "product"
        ? "请先将完成的子弹交到仓库。"
        : "请等待组装完成。"
    );
    return;
  }

  job.phase = "blank";
  giveCarry(player, BLANK_ATTACH_MODEL);
  player.sendClientMessage(
    Color.info,
    "你拿起了弹壳毛坯。把它送到组装机。"
  );
}

function onBenchPickup(
  player: Player,
  job: Job | undefined,
  benchIndex: number
): void {
  if (!job) {
    player.sendClientMessage(Color.error, "请先在更衣室开始工作。");
    return;
  }

  if (job.phase === "craft") {
    return;
  }

  if (job.phase !== "blank") {
    player.sendClientMessage(
      Color.error,
      job.phase === "product"
        ? "子弹已经组装完成——把它们送到仓库。"
        : "去黄色标记处领取弹壳毛坯。"
    );
    return;
  }

  const bench = BENCH_POINTS[benchIndex];
  if (!bench) {
    return;
  }

  startCraft(player, job, bench);
}

function onStockPickup(player: Player, job: Job | undefined): void {
  if (!job) {
    player.sendClientMessage(Color.error, "请先在更衣室开始工作。");
    return;
  }

  if (job.phase !== "product") {
    player.sendClientMessage(
      Color.error,
      job.phase === "blank"
        ? "先在机器上组装子弹。"
        : "你没有组装好的子弹。"
    );
    return;
  }

  job.phase = "idle";
  job.delivered += 1;
  clearCarry(player);
  playPutdown(player);

  addWarehouseAmmo(ORG_ARMY_ID, AMMO_PER_BOX);
  refreshArmyAmmoStockLabel();

  player.sendClientMessage(
    Color.info,
    `一批子弹已交到军队仓库 (+${AMMO_PER_BOX} 发). 已完成批次: ${job.delivered}.`
  );
}

function startCraft(
  player: Player,
  job: Job,
  bench: (typeof BENCH_POINTS)[number]
): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  clearCarry(player);
  job.phase = "craft";

  try {
    destroyCraftObject(job);
    job.craftObject = new ObjectMp(
      PRODUCT_MODEL,
      bench.object.x,
      bench.object.y,
      bench.object.z,
      0,
      0,
      bench.object.rz,
      OBJECT_DRAW
    );
  } catch {
    job.craftObject = null;
  }

  try {
    player.setFacingAngle(bench.facing);
    player.toggleControllable(false);
    player.applyAnimation(
      "OTB",
      "BETSLP_LOOP",
      4.1,
      true,
      false,
      false,
      false,
      0,
      ANIM_SYNC_ALL
    );
    player.setAttachedObject(
      SLOT_HAND,
      TOOL_ATTACH_MODEL,
      5,
      0.037,
      0.072,
      0,
      155,
      0,
      0,
      1,
      1,
      1,
      0,
      0
    );
  } catch {
    // 否则 phase=craft 会被冻结且没有计时器，导致永久卡住。
    cancelCraft(player, job, true);
    job.phase = "blank";
    giveCarry(player, BLANK_ATTACH_MODEL);
    player.sendClientMessage(Color.error, "机器暂不可用，请重试。");
    return;
  }

  if (job.craftTimer) {
    clearTimeout(job.craftTimer);
  }

  job.craftTimer = setTimeout(() => {
    job.craftTimer = null;
    finishCraft(player, id);
  }, CRAFT_MS);
}

function finishCraft(player: Player, expectedId: number): void {
  const id = playerId(player);
  if (id === null || id !== expectedId) {
    return;
  }

  const job = jobs.get(id);
  if (!job || job.phase !== "craft") {
    return;
  }

  destroyCraftObject(job);
  clearHandObject(player);

  try {
    player.clearAnimations(ANIM_SYNC_ALL);
    player.toggleControllable(true);
  } catch {
    // 玩家已经离开。
  }

  if (!isPlayerActive(player)) {
    return;
  }

  const success = Math.random() < CRAFT_SUCCESS_CHANCE;
  if (!success) {
    job.phase = "idle";
    job.defects += 1;
    player.sendClientMessage(
      Color.error,
      "次品: 弹壳出现裂纹。请领取新的毛坯。"
    );
    return;
  }

  job.phase = "product";
  giveCarry(player, BLANK_ATTACH_MODEL);
  player.sendClientMessage(
    Color.info,
    "子弹已组装完成。把箱子送到成品仓库。"
  );
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

  if (jobs.has(id)) {
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

  if (isMinerOnShift(player) || isLoaderOnShift(player)) {
    player.sendClientMessage(Color.error, "请先结束另一份工作。");
    return;
  }

  if (getExam(player)) {
    player.sendClientMessage(Color.error, "请先完成驾校考试。");
    return;
  }

  const membership = getMembership(account);
  if (membership?.org.id !== ORG_ARMY_ID) {
    player.sendClientMessage(Color.error, "军队员工才能在车间工作。");
    return;
  }

  if (!isInFactoryOnFoot(player) || !near(player.getPos(), HIRE_POINT, PICKUP_RADIUS + 0.8)) {
    player.sendClientMessage(Color.error, "请靠近车间更衣室。");
    return;
  }

  const skin = account.gender === "female" ? SKIN_FEMALE : SKIN_MALE;
  jobs.set(id, {
    phase: "idle",
    delivered: 0,
    defects: 0,
    craftObject: null,
    craftTimer: null,
  });

  try {
    player.setSkin(skin);
    preloadAnims(player);
  } catch {
    abortShift(player, false);
    return;
  }

  player.sendClientMessage(
    Color.info,
    "子弹车间的工作班次已开始。领取弹壳毛坯并在机器上组装一批子弹。"
  );
  player.sendClientMessage(
    Color.info,
    "将组装好的子弹交到仓库。要结束班次，请回到更衣室。"
  );
}

function finishShift(
  player: Player,
  options: { requireHirePoint: boolean; notifyExit: boolean }
): void {
  const id = playerId(player);
  const account = getAccount(player);
  const job = id !== null ? jobs.get(id) : undefined;
  if (id === null || !account || !job) {
    return;
  }

  if (options.requireHirePoint) {
    try {
      if (
        !isInFactoryOnFoot(player) ||
        !near(player.getPos(), HIRE_POINT, PICKUP_RADIUS + 0.8)
      ) {
        player.sendClientMessage(Color.error, "请靠近车间更衣室。");
        return;
      }
    } catch {
      return;
    }
  }

  const salary = Math.max(0, job.delivered * PAY_PER_BOX - job.defects * FINE_PER_DEFECT);
  const delivered = job.delivered;
  const defects = job.defects;

  cancelCraft(player, job, true);
  restoreWorker(player, resolvePlayerSkin(account));
  jobs.delete(id);
  standing.delete(id);

  if (salary > 0) {
    patchAccount(player, { money: account.money + salary });
    const updated = getAccount(player);
    if (updated) {
      applyWallet(player, updated);
    }
    queueSave(player);
  }

  if (!isPlayerActive(player)) {
    return;
  }

  if (options.notifyExit) {
    player.sendClientMessage(
      Color.info,
      salary > 0
        ? `你已离开工厂。班次已结束。工资: $${salary}.`
        : "你已离开工厂。班次已结束。"
    );
    return;
  }

  if (delivered > 0 || defects > 0) {
    player.sendClientMessage(
      Color.info,
      `班次结束。完成批次: ${delivered}，次品: ${defects}. 工资: $${salary}.`
    );
  } else {
    player.sendClientMessage(Color.info, "班次结束。你没有赚到钱。");
  }
}

function abortShift(player: Player, notify: boolean): void {
  const id = playerId(player);
  const job = id !== null ? jobs.get(id) : undefined;
  if (id === null || !job) {
    return;
  }

  cancelCraft(player, job, true);
  const account = getAccount(player);
  restoreWorker(player, account ? resolvePlayerSkin(account) : null);
  jobs.delete(id);
  standing.delete(id);

  if (notify && isPlayerActive(player)) {
    player.sendClientMessage(
      Color.error,
      "班次中断。未发放的工资已作废。"
    );
  }
}

function cancelCraft(player: Player, job: Job, unlock: boolean): void {
  if (job.craftTimer) {
    clearTimeout(job.craftTimer);
    job.craftTimer = null;
  }

  destroyCraftObject(job);
  clearCarry(player);

  if (unlock) {
    try {
      player.toggleControllable(true);
      player.clearAnimations(ANIM_SYNC_ALL);
    } catch {
      // 玩家已经离开。
    }
  }
}

function destroyCraftObject(job: Job): void {
  if (!job.craftObject) {
    return;
  }

  try {
    job.craftObject.destroy();
  } catch {
    // 已经销毁。
  }

  job.craftObject = null;
}

function giveCarry(player: Player, model: number): void {
  clearCarry(player);
  try {
    player.setAttachedObject(
      SLOT_HAND,
      model,
      1,
      -0.073,
      0.358,
      -0.032,
      0,
      88,
      0,
      1,
      1,
      1,
      0,
      0
    );
    player.setSpecialAction(SPECIAL_ACTION_CARRY);
  } catch {
    // 槽位尚未准备好。
  }
}

function clearCarry(player: Player): void {
  clearHandObject(player);
  try {
    player.setSpecialAction(SPECIAL_ACTION_NONE);
    player.clearAnimations(ANIM_SYNC_ALL);
  } catch {
    // 玩家已经离开。
  }
}

function clearHandObject(player: Player): void {
  try {
    player.removeAttachedObject(SLOT_HAND);
  } catch {
    // 槽位不存在。
  }
}

function playPutdown(player: Player): void {
  try {
    player.applyAnimation(
      "CARRY",
      "PUTDWN",
      4.1,
      false,
      false,
      false,
      false,
      0,
      ANIM_SYNC_ALL
    );
  } catch {
    // 稍后会加载动作库。
  }
}

function preloadAnims(player: Player): void {
  try {
    player.applyAnimation("OTB", "BETSLP_LOOP", 4.1, false, false, false, false, 1, ANIM_SYNC_ALL);
    player.applyAnimation("CARRY", "PUTDWN", 4.1, false, false, false, false, 1, ANIM_SYNC_ALL);
    player.clearAnimations(ANIM_SYNC_ALL);
  } catch {
    // 第一次组装时会加载。
  }
}

function restoreWorker(player: Player, skin: number | null): void {
  try {
    clearCarry(player);
    player.toggleControllable(true);
    if (skin !== null) {
      player.setSkin(skin);
    }
  } catch {
    // 玩家已经离开。
  }
}

function showHireDialog(player: Player): void {
  try {
    Dialog.show(
      player,
      ARMY_FACTORY_HIRE_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "弹药车间",
      "要换上制服并开始弹药车间的工作吗？",
      "是",
      "否"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开对话框。");
  }
}

function showQuitDialog(player: Player, job: Job): void {
  const salary = Math.max(0, job.delivered * PAY_PER_BOX - job.defects * FINE_PER_DEFECT);
  try {
    Dialog.show(
      player,
      ARMY_FACTORY_QUIT_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "弹药车间",
      `要结束工作并领取工资吗？\n批次：${job.delivered}，次品：${job.defects}，应发工资：$${salary}`,
      "是",
      "否"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开对话框。");
  }
}

function isInFactoryOnFoot(player: Player): boolean {
  try {
    return (
      player.getState() === PLAYER_STATE_ONFOOT &&
      player.getVirtualWorld() === ARMY_FACTORY_WORLD &&
      player.getInterior() === ARMY_FACTORY_INTERIOR
    );
  } catch {
    return false;
  }
}

function near(
  pos: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
  radius = PICKUP_RADIUS
): boolean {
  return Math.hypot(pos.x - point.x, pos.y - point.y, pos.z - point.z) <= radius;
}

function forgetSlot(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    standing.delete(id);
  }
}
