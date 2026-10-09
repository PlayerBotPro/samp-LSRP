import { Checkpoint, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { CHAT_RADIUS, WHISPER_RADIUS, arePlayersNearby, sendNearby } from "../../shared/nearby";
import {
  isPlayerActive,
  playerChatName,
  playerId,
  playerName,
} from "../../shared/player";
import { byGender } from "../auth/gender";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { setPlayerWantedLevel } from "../auth/wanted";
import { isCuffed } from "../cuff";
import {
  ORG_FBI_ID,
  getMembership,
  isLawOfficer,
  notifyLawStaff,
} from "../org";
import { queueSave } from "../persist";
import { applyJail, isJailed } from "../prison/sentence";
import { STREET_WORLD } from "../spawn/point";
import { resolveLawNearbyTarget } from "./law-target";
import { registerCommand } from "./registry";

/** 与自首规则相同：1★ = 10 分钟。 */
const MINUTES_PER_WANTED = 10;
const REWARD_PER_STAR = 500;
const STATION_RADIUS = 10;
const CHECKPOINT_RADIUS = 4;
const PENDING_TTL_MS = 10 * 60 * 1000;
const PLAYER_STATE_DRIVER = 2;

type ArrestStation = {
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
};

/** 警局车库附近的自首点。 */
const STATIONS: readonly ArrestStation[] = [
  {
    key: "police",
    name: "州警察局",
    x: 626.0856,
    y: -590.1869,
    z: 16.7614,
  },
  {
    key: "lspd",
    name: "LSPD",
    x: 1529.2043,
    y: -1678.8394,
    z: 5.8906,
  },
];

type PendingArrest = {
  targetSlot: number;
  targetAccountId: number;
  station: ArrestStation;
  expiresAt: number;
};

const pending = new Map<number, PendingArrest>();
const busy = new Set<number>();

registerCommand(
  "arrest",
  "在警局逮捕玩家（警察 / FBI）",
  (player, args) => {
    const resolved = resolveLawNearbyTarget(
      player,
      args,
      "用法： /arrest [id]"
    );
    if (!resolved.ok) {
      return;
    }

    const { officer, target, officerId, targetId } = resolved;
    const station = nearestStation(officer);
    if (!station) {
      officer.sendClientMessage(
        Color.error,
        "只能在 LSPD 或州警局附近逮捕玩家。"
      );
      return;
    }

    if (isLawOfficer(target)) {
      officer.sendClientMessage(
        Color.error,
        "不能逮捕警察或 FBI 员工。"
      );
      return;
    }

    if (isJailed(target)) {
      officer.sendClientMessage(Color.error, "玩家已经在监狱里。");
      return;
    }

    if (!isCuffed(target)) {
      officer.sendClientMessage(Color.error, "玩家必须戴着手铐。");
      return;
    }

    const targetAccount = getAccount(target);
    if (!targetAccount || targetAccount.wantedLevel <= 0) {
      officer.sendClientMessage(Color.error, "该玩家没有通缉等级。");
      return;
    }

    if (isTargetPending(targetId, targetAccount.id)) {
      officer.sendClientMessage(
        Color.error,
        "该玩家已经被押送去逮捕。"
      );
      return;
    }

    if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
      officer.sendClientMessage(Color.error, "玩家距离太远。");
      return;
    }

    // 清除上次逮捕状态和检查点（否则 set 失败时会残留其他人的标记）。
    clearPending(officerId, true);

    try {
      Checkpoint.set(
        officer,
        station.x,
        station.y,
        station.z,
        CHECKPOINT_RADIUS
      );
    } catch {
      officer.sendClientMessage(Color.error, "无法设置检查点。");
      return;
    }

    pending.set(officerId, {
      targetSlot: targetId,
      targetAccountId: targetAccount.id,
      station,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });

    const officerName = playerName(officer);
    const targetName = playerName(target);
    const verb = byGender(
      getAccount(officer)?.gender ?? null,
      "带领了",
      "带领了"
    );

    sendNearby(
      officer,
      CHAT_RADIUS,
      Color.action,
      `${officerName} ${verb} ${targetName} 前往警局（${station.name}）。`
    );

    officer.sendClientMessage(
      Color.info,
      `已逮捕: ${targetName}. 驾车前往 ${station.name} 附近的检查点以完成逮捕。`
    );
    try {
      target.sendClientMessage(
        Color.error,
        `${officerName} 正押送你前往警局 (${station.name}).`
      );
    } catch {
      // 已离线。
    }

    // 如果已经载着被捕者在检查点范围内驾驶，可能不会再次触发 enter。
    void onArrestCheckpoint(officer, true);
  }
);

export function bindArrestCheckpoints(): void {
  omp.on("playerEnterCheckpoint", (player) => {
    void onArrestCheckpoint(player, false);
  });

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    if (id !== null) {
      clearPending(id, false);
      clearPendingByTarget(id);
    }
  });

  omp.on("playerDeath", (player) => {
    const id = playerId(player);
    if (id === null) {
      return;
    }

    clearPending(id, true);
    clearPendingByTarget(id);
  });
}

async function onArrestCheckpoint(
  player: Player,
  silentIfNotReady: boolean
): Promise<void> {
  const officerId = playerId(player);
  if (officerId === null || !isAuthenticated(player) || !isLawOfficer(player)) {
    return;
  }

  const state = pending.get(officerId);
  if (!state) {
    return;
  }

  if (Date.now() > state.expiresAt) {
    clearPending(officerId, true);
    tell(player, Color.error, "逮捕时间已到，请重新开始：/arrest。");
    return;
  }

  if (busy.has(officerId)) {
    return;
  }

  let vehicleId = -1;
  try {
    if (!player.isInAnyVehicle() || player.getState() !== PLAYER_STATE_DRIVER) {
      if (!silentIfNotReady) {
        tell(player, Color.error, "只能在驾驶时完成逮捕。");
      }
      return;
    }
    vehicleId = player.getVehicleID();
  } catch {
    if (!silentIfNotReady) {
      tell(player, Color.error, "只能在驾驶时完成逮捕。");
    }
    return;
  }

  if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
    if (!silentIfNotReady) {
      tell(player, Color.error, "只能在驾驶时完成逮捕。");
    }
    return;
  }

  if (!isNearStation(player, state.station, CHECKPOINT_RADIUS + 2)) {
    return;
  }

  const target = omp.players.at(state.targetSlot);
  const targetAccount = target ? getAccount(target) : null;
  if (
    !target ||
    !isPlayerActive(target) ||
    !isAuthenticated(target) ||
    !targetAccount ||
    targetAccount.id !== state.targetAccountId
  ) {
    clearPending(officerId, true);
    tell(player, Color.error, "被捕者已离线，逮捕已取消。");
    return;
  }

  if (isLawOfficer(target) || isJailed(target)) {
    clearPending(officerId, true);
    tell(player, Color.error, "逮捕已无法继续。");
    return;
  }

  if (!isCuffed(target)) {
    clearPending(officerId, true);
    tell(player, Color.error, "被捕者的手铐已解开，逮捕已取消。");
    return;
  }

  if (targetAccount.wantedLevel <= 0) {
    clearPending(officerId, true);
    tell(player, Color.error, "被捕者不再被通缉，逮捕已取消。");
    return;
  }

  try {
    if (!target.isInAnyVehicle() || target.getVehicleID() !== vehicleId) {
      if (!silentIfNotReady) {
        tell(
          player,
          Color.error,
          "被捕者必须在你的车辆中（/putpl）。"
        );
      }
      return;
    }
  } catch {
    clearPending(officerId, true);
    tell(player, Color.error, "被捕者已离线，逮捕已取消。");
    return;
  }

  const wanted = targetAccount.wantedLevel;
  const minutes = arrestMinutes(wanted);
  const reward = wanted * REWARD_PER_STAR;

  busy.add(officerId);
  try {
    const ok = await applyJail(target, minutes);
    if (!ok) {
      tell(player, Color.error, "无法将玩家送入监狱，请重试。");
      return;
    }

    setPlayerWantedLevel(target, 0);
    clearPending(officerId, true);

    payOfficer(player, reward);

    const officerAccount = getAccount(player);
    const membership = officerAccount ? getMembership(officerAccount) : null;
    const rankTitle = membership?.rank.title ?? lawFallbackRank(player);
    const officerLabel = playerChatName(player);
    const targetLabel = playerChatName(target);
    const verb = byGender(
      officerAccount?.gender ?? null,
      "送入监狱",
      "送入监狱"
    );

    notifyLawStaff(
      `调度：${rankTitle} ${officerLabel} ${verb} ${targetLabel} 入狱（${state.station.name}）。`
    );

    sendNearby(
      player,
      CHAT_RADIUS,
      Color.action,
      `${playerName(player)} ${verb} ${playerName(target)} 入狱。`
    );

    tell(
      player,
      Color.info,
      `你已将 ${playerName(target)} 送入监狱。刑期：${minutes} 分钟。奖励：${formatMoney(reward)}。`
    );

    try {
      target.sendClientMessage(
        Color.error,
        `你被 ${playerName(player)} 逮捕了。通缉已解除。`
      );
    } catch {
      // 已在监狱中 / 已离开。
    }
  } finally {
    busy.delete(officerId);
  }
}

function nearestStation(player: Player): ArrestStation | null {
  try {
    if (player.getVirtualWorld() !== STREET_WORLD || player.getInterior() !== 0) {
      return null;
    }

    const pos = player.getPos();
    let best: ArrestStation | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const station of STATIONS) {
      const dist = Math.hypot(pos.x - station.x, pos.y - station.y, pos.z - station.z);
      if (dist <= STATION_RADIUS && dist < bestDist) {
        best = station;
        bestDist = dist;
      }
    }

    return best;
  } catch {
    return null;
  }
}

function isNearStation(
  player: Player,
  station: ArrestStation,
  radius: number
): boolean {
  try {
    if (player.getVirtualWorld() !== STREET_WORLD || player.getInterior() !== 0) {
      return false;
    }

    const pos = player.getPos();
    return (
      Math.hypot(pos.x - station.x, pos.y - station.y, pos.z - station.z) <= radius
    );
  } catch {
    return false;
  }
}

function arrestMinutes(wantedLevel: number): number {
  return Math.max(1, Math.floor(wantedLevel)) * MINUTES_PER_WANTED;
}

function isTargetPending(targetSlot: number, targetAccountId: number): boolean {
  for (const state of pending.values()) {
    if (
      state.targetSlot === targetSlot ||
      state.targetAccountId === targetAccountId
    ) {
      return true;
    }
  }
  return false;
}

function clearPending(officerId: number, disableCp: boolean): void {
  if (!pending.delete(officerId)) {
    return;
  }

  if (!disableCp) {
    return;
  }

  const officer = omp.players.at(officerId);
  if (!officer || !isPlayerActive(officer)) {
    return;
  }

  try {
    Checkpoint.disable(officer);
  } catch {
    // 已离线。
  }
}

function clearPendingByTarget(targetSlot: number): void {
  for (const [officerId, state] of pending) {
    if (state.targetSlot !== targetSlot) {
      continue;
    }

    clearPending(officerId, true);
    const officer = omp.players.at(officerId);
    if (officer && isPlayerActive(officer)) {
      tell(officer, Color.error, "被捕者已离开，逮捕已取消。");
    }
  }
}

function payOfficer(player: Player, amount: number): void {
  const account = getAccount(player);
  if (!account || amount <= 0) {
    return;
  }

  patchAccount(player, { money: account.money + amount });
  const updated = getAccount(player);
  if (updated) {
    applyWallet(player, updated);
  }
  queueSave(player);
}

function lawFallbackRank(player: Player): string {
  const account = getAccount(player);
  const orgId = account ? getMembership(account)?.org.id : undefined;
  return orgId === ORG_FBI_ID ? "特工" : "警官";
}

function tell(player: Player, color: number, text: string): void {
  try {
    if (isPlayerActive(player)) {
      player.sendClientMessage(color, text);
    }
  } catch {
    // 槽位为空。
  }
}
