import { Actor, Dialog, ObjectMp, omp, TextLabel, type Player } from "@omp-node/core";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { applyWallet, getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { isCuffed } from "../cuff";
import { queueSave } from "../persist";
import { STREET_WORLD } from "../spawn/point";
import type { GameModule } from "../types";

export const FARM_MENU_DIALOG_ID = 166;

const DIALOG_STYLE_LIST = 2;
const KEY_WALK = 1024;
const KEY_SPRINT = 8;
const PLAYER_STATE_ONFOOT = 1;
const ANIM_SYNC_ALL = 1;

const TOOL_PRICE = 4000;
const FLAX_PRICE = 100;
const TOOL_SLOT = 9;
const TOOL_MODEL = 18890;
const TOOL_BONE = 6;
const PLANT_MODEL = 865;
const PLANT_DRAW = 150;
const LABEL_DRAW = 15;
const BUY_RADIUS = 2;
const HARVEST_RADIUS = 3;
const RIPE_SCORE = 10;
const GROW_SECONDS = 180;
const HARVEST_MIN_MS = 4000;
const HARVEST_EXTRA_MS = 7099;
const FIELD_TICK_MS = 1000;

const HINT = 0x42b02cff;
const INFO = 0x73b461ff;
const LABEL_COLOR = 0xffffffff;

const EMILIO = {
  skin: 132,
  x: 1932.0425,
  y: 168.9562,
  z: 37.2752,
  angle: 343.3099,
} as const;

const ZONE = {
  minX: 1898.4,
  minY: 143.4,
  maxX: 2014.4,
  maxY: 259.4,
} as const;

const BEDS: readonly { x: number; y: number; z: number }[] = [
  { x: 1923.527, y: 198.6066, z: 34.1186 },
  { x: 1945.6036, y: 194.377, z: 33.6812 },
  { x: 1969.2124, y: 189.641, z: 32.8882 },
  { x: 1994.8457, y: 184.728, z: 30.7683 },
  { x: 1923.8125, y: 217.5097, z: 30.2035 },
  { x: 1944.281, y: 214.641, z: 30.1266 },
  { x: 1968.6814, y: 210.169, z: 29.9409 },
  { x: 1993.5891, y: 207.9904, z: 27.8253 },
  { x: 1924.077, y: 235.8828, z: 29.7884 },
  { x: 1944.6425, y: 232.0957, z: 29.7784 },
  { x: 1967.7579, y: 227.9877, z: 29.2351 },
  { x: 1992.9681, y: 226.3499, z: 28.0551 },
];

type PlantLook = "ripe" | "soil" | "sprout";

type Plot = {
  x: number;
  y: number;
  z: number;
  score: number;
  /** 0:裸土;1:幼苗;2:可收获. */
  status: 0 | 1 | 2;
  seconds: number;
  object: ObjectMp | null;
  label: TextLabel | null;
  timer: ReturnType<typeof setInterval> | null;
};

type ToolState = { userId: number };
type HarvestState = { userId: number; plot: number; token: number; timer: ReturnType<typeof setTimeout> };

const plots: Plot[] = [];
const tools = new Map<number, ToolState>();
const linen = new Map<number, { userId: number; count: number }>();
const harvests = new Map<number, HarvestState>();
let harvestToken = 1;
let fieldTimer: ReturnType<typeof setInterval> | null = null;

export const farmModule: GameModule = {
  name: "farm",
  start() {
    if (plots.length === 0) {
      spawnEmilio();
      spawnPlots();
      bindFarm();
    }
    if (!fieldTimer) {
      fieldTimer = setInterval(tickField, FIELD_TICK_MS);
    }
  },
};

function spawnEmilio(): void {
  try {
    const actor = new Actor(EMILIO.skin, EMILIO.x, EMILIO.y, EMILIO.z, EMILIO.angle);
    actor.setVirtualWorld(STREET_WORLD);
    actor.setInvulnerable(true);
  } catch (error) {
    console.error("[farm] 无法创建埃米利奥", error);
  }

  try {
    new TextLabel(
      "{FFFFFF}埃米利奥\n{73B461}亚麻农场\n{FFFFFF}按 ALT 互动",
      LABEL_COLOR,
      EMILIO.x,
      EMILIO.y,
      EMILIO.z + 1.45,
      10,
      STREET_WORLD,
      false
    );
  } catch (error) {
    console.error("[farm] 无法创建埃米利奥的文字标签", error);
  }
}

function spawnPlots(): void {
  for (const bed of BEDS) {
    const plot: Plot = {
      x: bed.x,
      y: bed.y,
      z: bed.z,
      score: RIPE_SCORE,
      status: 2,
      seconds: 0,
      object: null,
      label: null,
      timer: null,
    };
    plots.push(plot);
    respawnPlant(plot, "ripe");
    try {
      plot.label = new TextLabel(ripeText(plot.score), LABEL_COLOR, plot.x, plot.y, plot.z, LABEL_DRAW, STREET_WORLD, false);
    } catch (error) {
      console.error("[farm] 无法创建田垄文字标签", error);
    }
  }
}

function bindFarm(): void {
  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const pressedWalk = (newKeys & KEY_WALK) !== 0 && (oldKeys & KEY_WALK) === 0;
    const pressedSprint = (newKeys & KEY_SPRINT) !== 0 && (oldKeys & KEY_SPRINT) === 0;
    const releasedSprint = (newKeys & KEY_SPRINT) === 0 && (oldKeys & KEY_SPRINT) !== 0;

    if (pressedWalk) {
      openMenu(player);
    }
    if (releasedSprint) {
      cancelHarvest(player, true);
    }
    if (pressedSprint) {
      beginHarvest(player);
    }
  });

  omp.on("dialogResponse", (player, dialogId, response, listItem) => {
    if (Number(dialogId) !== FARM_MENU_DIALOG_ID || !isPlayerActive(player)) {
      return;
    }
    if (Number(response) === 0) {
      return;
    }
    onMenu(player, Number(listItem));
  });

  omp.on("playerDeath", (player) => {
    cancelHarvest(player, false, false);
  });

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    if (slot !== null) {
      forgetSlot(slot);
    }
  });

  omp.on("playerConnect", (player) => {
    const slot = playerId(player);
    if (slot !== null) {
      forgetSlot(slot);
    }
  });
}

function openMenu(player: Player): void {
  if (!canWork(player) || !insideField(player) || !near(player, EMILIO.x, EMILIO.y, EMILIO.z, BUY_RADIUS)) {
    return;
  }

  const count = flaxCount(player);
  Dialog.show(
    player,
    FARM_MENU_DIALOG_ID,
    DIALOG_STYLE_LIST,
    "亚麻农场",
    [
      "{FFFFFF}开始工作",
      "{FFFFFF}辞职",
      `{FFFFFF}出售亚麻 {73B461}(${count} 份)`,
    ].join("\n"),
    "选择",
    "关闭"
  );
}

function onMenu(player: Player, listItem: number): void {
  if (!isAuthenticated(player) || !canWork(player)) {
    return;
  }
  if (!insideField(player) || !near(player, EMILIO.x, EMILIO.y, EMILIO.z, BUY_RADIUS)) {
    player.sendClientMessage(HINT, "你离埃米利奥太远了.");
    return;
  }
  if (listItem === 0) {
    hire(player);
    return;
  }
  if (listItem === 1) {
    quitJob(player);
    return;
  }
  if (listItem === 2) {
    sellFlax(player);
  }
}

function hire(player: Player): void {
  if (!isAuthenticated(player) || !canWork(player)) {
    return;
  }
  if (!near(player, EMILIO.x, EMILIO.y, EMILIO.z, BUY_RADIUS)) {
    player.sendClientMessage(HINT, "你离埃米利奥太远了.");
    return;
  }

  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return;
  }
  if (hasTool(player)) {
    player.sendClientMessage(HINT, "你已在亚麻农场工作.");
    return;
  }
  if (account.money < TOOL_PRICE) {
    player.sendClientMessage(HINT, "你的资金不足.");
    return;
  }

  const next = account.money - TOOL_PRICE;
  patchAccount(player, { money: next });
  const paid = getAccount(player);
  if (!paid) {
    return;
  }
  applyWallet(player, paid);

  let attached = false;
  try {
    attached = player.setAttachedObject(
      TOOL_SLOT,
      TOOL_MODEL,
      TOOL_BONE,
      0.04,
      -0.05,
      0.01,
      0,
      0,
      0,
      1,
      0.99,
      0.43,
      0,
      0
    );
  } catch {
    attached = false;
  }
  if (!attached) {
    patchAccount(player, { money: next + TOOL_PRICE });
    const restored = getAccount(player);
    if (restored) {
      applyWallet(player, restored);
    }
    player.sendClientMessage(HINT, "无法发放工具,款项已退还.");
    return;
  }

  tools.set(slot, { userId: account.id });
  queueSave(player);
  player.sendClientMessage(INFO, `[亚麻农场] 你已开始工作,工具费用为 ${formatMoney(TOOL_PRICE)}.`);
  player.sendClientMessage(HINT, "[提示] 靠近成熟的田垄,按住空格键直到收获完成.");
  player.sendClientMessage(HINT, "[提示] 离开农田会结束工作并收回工具.亚麻会保留,可出售给埃米利奥.");
}

function quitJob(player: Player): void {
  const slot = playerId(player);
  if (slot === null || !hasTool(player)) {
    player.sendClientMessage(HINT, "你尚未在亚麻农场工作.");
    return;
  }
  dropTool(player, slot, "[亚麻农场] 你已辞职,工具已归还,亚麻仍由你保留.");
}

function sellFlax(player: Player): void {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return;
  }

  const count = flaxCount(player);
  if (count <= 0) {
    player.sendClientMessage(HINT, "你没有可出售的亚麻.");
    return;
  }

  linen.set(slot, { userId: account.id, count: 0 });
  const total = count * FLAX_PRICE;
  patchAccount(player, { money: account.money + total });
  const paid = getAccount(player);
  if (!paid) {
    linen.set(slot, { userId: account.id, count });
    return;
  }
  applyWallet(player, paid);
  queueSave(player);
  player.sendClientMessage(INFO, `[亚麻农场] 已出售 ${count} 份亚麻,获得 ${formatMoney(total)}.`);
}

function beginHarvest(player: Player): void {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account || harvests.has(slot) || !canWork(player)) {
    return;
  }

  const plotIndex = nearestPlot(player);
  if (plotIndex === null) {
    return;
  }
  const plot = plots[plotIndex];
  if (!plot) {
    return;
  }

  if (!hasTool(player)) {
    player.sendClientMessage(HINT, "[提示] 请先到埃米利奥处应聘,再收获亚麻.");
    return;
  }
  if (plot.status !== 2 || plot.timer) {
    player.sendClientMessage(INFO, "[亚麻农场] 这块田垄的亚麻尚未成熟.");
    return;
  }
  if (plot.score <= 0) {
    return;
  }

  try {
    player.applyAnimation("BOMBER", "BOM_Plant", 4.1, true, true, true, true, 0, ANIM_SYNC_ALL);
  } catch {
    player.sendClientMessage(INFO, "[亚麻农场] 无法开始收获,请重试.");
    return;
  }

  const token = harvestToken++;
  const wait = HARVEST_MIN_MS + Math.floor(Math.random() * HARVEST_EXTRA_MS);
  const timer = setTimeout(() => completeHarvest(player, slot, account.id, plotIndex, token), wait);
  harvests.set(slot, { userId: account.id, plot: plotIndex, token, timer });
}

function cancelHarvest(player: Player, tell: boolean, clearAnim = true): void {
  const slot = playerId(player);
  if (slot === null) {
    return;
  }
  const state = harvests.get(slot);
  if (!state) {
    return;
  }
  clearTimeout(state.timer);
  harvests.delete(slot);
  if (clearAnim) {
    clearPlantAnim(player);
  }
  if (tell && isPlayerActive(player)) {
    player.sendClientMessage(INFO, "[亚麻农场] 收获已中断,请按住空格键直到收获完成.");
  }
}

function forgetSlot(slot: number): void {
  const harvest = harvests.get(slot);
  if (harvest) {
    clearTimeout(harvest.timer);
    harvests.delete(slot);
  }
  tools.delete(slot);
  linen.delete(slot);
}

function completeHarvest(player: Player, slot: number, userId: number, plotIndex: number, token: number): void {
  const state = harvests.get(slot);
  if (!state || state.token !== token || state.plot !== plotIndex || state.userId !== userId) {
    return;
  }
  harvests.delete(slot);

  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }
  const account = getAccount(player);
  const plot = plots[plotIndex];
  if (!account || account.id !== userId || !plot) {
    return;
  }
  let alive = false;
  try {
    alive = player.getHealth() > 0;
  } catch {
    alive = false;
  }
  if (!alive) {
    return;
  }
  clearPlantAnim(player);
  if (!canWork(player) || !hasTool(player) || !insideField(player)) {
    player.sendClientMessage(INFO, "[亚麻农场] 收获已中断.");
    return;
  }
  if (!near(player, plot.x, plot.y, plot.z, HARVEST_RADIUS)) {
    player.sendClientMessage(INFO, "[亚麻农场] 你离田垄太远了.");
    return;
  }
  if (plot.status !== 2 || plot.timer || plot.score <= 0) {
    player.sendClientMessage(INFO, "[亚麻农场] 这块田垄已被收获.");
    return;
  }

  plot.score -= 1;
  const bag = linen.get(slot);
  const count = (bag && bag.userId === userId ? bag.count : 0) + 1;
  linen.set(slot, { userId, count });
  player.sendClientMessage(INFO, `[亚麻农场] 亚麻 +1,已收获:${count}.`);

  if (plot.score > 0) {
    setLabel(plot, ripeText(plot.score));
    return;
  }

  plot.status = 0;
  plot.seconds = GROW_SECONDS;
  respawnPlant(plot, "soil");
  setLabel(plot, growText(plot.seconds));
  if (plot.timer) {
    clearInterval(plot.timer);
  }
  plot.timer = setInterval(() => growTick(plot), FIELD_TICK_MS);
}

function growTick(plot: Plot): void {
  plot.seconds -= 1;
  if (plot.seconds > 0) {
    setLabel(plot, growText(plot.seconds));
    return;
  }

  if (plot.status === 0) {
    plot.status = 1;
    plot.seconds = GROW_SECONDS;
    respawnPlant(plot, "sprout");
    setLabel(plot, growText(plot.seconds));
    return;
  }

  if (plot.status !== 1) {
    if (plot.timer) {
      clearInterval(plot.timer);
      plot.timer = null;
    }
    return;
  }

  if (plot.timer) {
    clearInterval(plot.timer);
    plot.timer = null;
  }
  plot.status = 2;
  plot.score = RIPE_SCORE;
  plot.seconds = 0;
  respawnPlant(plot, "ripe");
  setLabel(plot, ripeText(plot.score));
}

function tickField(): void {
  omp.players.forEach((player) => {
    const slot = playerId(player);
    if (slot === null || !tools.has(slot)) {
      return;
    }
    const tool = tools.get(slot);
    const account = getAccount(player);
    if (!tool || !account || tool.userId !== account.id) {
      dropTool(player, slot, null);
      return;
    }
    if (!insideField(player)) {
      dropTool(player, slot, "[亚麻农场] 你已离开农田,工作已结束,工具已归还,亚麻仍由你保留.");
    }
  });
}

function dropTool(player: Player, slot: number, message: string | null): void {
  if (!tools.has(slot)) {
    return;
  }
  tools.delete(slot);
  cancelHarvest(player, false);
  if (isPlayerActive(player)) {
    try {
      player.removeAttachedObject(TOOL_SLOT);
    } catch {
      // 槽位已为空.
    }
    if (message) {
      player.sendClientMessage(INFO, message);
    }
  }
}

function respawnPlant(plot: Plot, look: PlantLook): void {
  if (plot.object) {
    try {
      plot.object.destroy();
    } catch {
      // 物体已移除.
    }
    plot.object = null;
  }

  try {
    const object = new ObjectMp(PLANT_MODEL, plot.x, plot.y, plot.z - 1.2, 0, 0, 90, PLANT_DRAW);
    if (look === "soil") {
      object.setMaterial(0, 812, "gta_proc_grassland", "oak2b", 0);
    } else if (look === "sprout") {
      object.setMaterial(0, 817, "gta_procflowers", "gras07Si", 0);
    }
    plot.object = object;
  } catch (error) {
    console.error("[farm] 无法更新田垄", error);
  }
}

function setLabel(plot: Plot, text: string): void {
  if (!plot.label) {
    return;
  }
  try {
    plot.label.updateText(LABEL_COLOR, text);
  } catch {
    // 文字标签已移除.
  }
}

function ripeText(score: number): string {
  return `亚麻 (${score}/${RIPE_SCORE})\n{73B461}收获作物请\n{FFFFFF}按空格键`;
}

function growText(seconds: number): string {
  return `{73B461}亚麻正在生长\n剩余时间: {FFFFFF}${formatGrowTime(seconds)}`;
}

function formatGrowTime(total: number): string {
  const time = Math.max(0, Math.floor(total));
  const minutes = Math.floor(time / 60);
  const seconds = time % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function hasTool(player: Player): boolean {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return false;
  }
  return tools.get(slot)?.userId === account.id;
}

function canWork(player: Player): boolean {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return false;
  }
  const account = getAccount(player);
  if (!account || account.jailSeconds > 0 || account.hospitalized || isCuffed(player)) {
    return false;
  }
  try {
    return player.getState() === PLAYER_STATE_ONFOOT && player.getHealth() > 0;
  } catch {
    return false;
  }
}

function insideField(player: Player): boolean {
  try {
    if (player.getVirtualWorld() !== STREET_WORLD || player.getInterior() !== 0) {
      return false;
    }
    const pos = player.getPos();
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      return true;
    }
    return pos.x >= ZONE.minX && pos.x <= ZONE.maxX && pos.y >= ZONE.minY && pos.y <= ZONE.maxY;
  } catch {
    // 读取坐标失败不应结束工作.
    return true;
  }
}

function flaxCount(player: Player): number {
  const slot = playerId(player);
  const account = getAccount(player);
  if (slot === null || !account) {
    return 0;
  }
  const bag = linen.get(slot);
  if (!bag || bag.userId !== account.id) {
    return 0;
  }
  return bag.count;
}

function nearestPlot(player: Player): number | null {
  let best = -1;
  let bestDistance = HARVEST_RADIUS;
  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i];
    if (!plot) {
      continue;
    }
    const distance = distanceTo(player, plot.x, plot.y, plot.z);
    if (distance !== null && distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best === -1 ? null : best;
}

function near(player: Player, x: number, y: number, z: number, radius: number): boolean {
  const distance = distanceTo(player, x, y, z);
  return distance !== null && distance <= radius;
}

function distanceTo(player: Player, x: number, y: number, z: number): number | null {
  try {
    const pos = player.getPos();
    const dx = pos.x - x;
    const dy = pos.y - y;
    const dz = pos.z - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  } catch {
    return null;
  }
}

function clearPlantAnim(player: Player): void {
  if (!isPlayerActive(player)) {
    return;
  }
  try {
    player.clearAnimations(ANIM_SYNC_ALL);
  } catch {
    // 玩家已离线.
  }
}
