import { Checkpoint, Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId, playerName } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { isLawOfficer } from "../org/law";
import { STREET_WORLD } from "../spawn/point";
import { setWantedClearedHook } from "../auth/wanted";
import { clearWantedByOfficer } from "./clear";
import { registerCommand } from "./registry";

export const WANTED_LIST_DIALOG_ID = 127;
export const WANTED_ACTION_DIALOG_ID = 128;

const DIALOG_STYLE_LIST = 2;
const DIALOG_STYLE_TABLIST_HEADERS = 5;
const PLAYER_STATE_WASTED = 7;
const CHECKPOINT_RADIUS = 3;
const PURSUIT_TICK_MS = 5000;
const DENY = "仅警察和 FBI 成员可使用此命令。";

type WantedRow = {
  slot: number;
  accountId: number;
  line: string;
  wanted: number;
  name: string;
};

type PendingTarget = {
  slot: number;
  accountId: number;
};

type Pursuit = {
  targetSlot: number;
  targetAccountId: number;
  timer: ReturnType<typeof setInterval>;
};

const pendingTarget = new Map<number, PendingTarget>();
const wantedLists = new Map<number, PendingTarget[]>();
const pursuits = new Map<number, Pursuit>();

registerCommand("wanted", "通缉玩家列表", (player) => {
  if (!isAuthenticated(player) || !isLawOfficer(player)) {
    player.sendClientMessage(Color.error, DENY);
    return;
  }

  const rows = collectWantedOnline();
  if (rows.length === 0) {
    player.sendClientMessage(Color.info, "当前没有被通缉的玩家在线。");
    return;
  }

  const officerId = playerId(player);
  if (officerId === null) {
    return;
  }

  wantedLists.set(
    officerId,
    rows.map((row) => ({ slot: row.slot, accountId: row.accountId }))
  );

  const body = ["姓名\t通缉等级", ...rows.map((row) => row.line)].join(
    "\n"
  );

  try {
    Dialog.show(
      player,
      WANTED_LIST_DIALOG_ID,
      DIALOG_STYLE_TABLIST_HEADERS,
      `通缉人数：${rows.length}`,
      body,
      "选择",
      "关闭"
    );
  } catch {
    wantedLists.delete(officerId);
    player.sendClientMessage(Color.error, "无法打开列表。");
  }
});

registerCommand("pursuit", "停止追踪通缉犯", (player) => {
  if (!isAuthenticated(player) || !isLawOfficer(player)) {
    player.sendClientMessage(Color.error, DENY);
    return;
  }

  const officerId = playerId(player);
  if (officerId === null || !pursuits.has(officerId)) {
    player.sendClientMessage(Color.error, "你没有跟踪任何人。");
    return;
  }

  stopPursuit(player, officerId, "追踪已停止。");
});

export function bindWantedDialogs(): void {
  setWantedClearedHook(stopPursuitsOfTarget);

  omp.on("dialogResponse", (player, dialogId, response, listItem) => {
    const id = Number(dialogId);
    if (id !== WANTED_LIST_DIALOG_ID && id !== WANTED_ACTION_DIALOG_ID) {
      return;
    }

    if (!isAuthenticated(player) || !isLawOfficer(player)) {
      clearPending(player);
      return;
    }

    const officerId = playerId(player);
    if (officerId === null) {
      return;
    }

    if (Number(response) === 0) {
      clearPending(player);
      return;
    }

    if (id === WANTED_LIST_DIALOG_ID) {
      const slots = wantedLists.get(officerId);
      wantedLists.delete(officerId);
      if (!slots) {
        return;
      }

      const picked = slots[Number(listItem)];
      if (!picked) {
        return;
      }

      const target = resolveTarget(picked);
      if (!target) {
        player.sendClientMessage(
          Color.error,
          "未找到玩家或该玩家已不再被通缉。"
        );
        return;
      }

      pendingTarget.set(officerId, picked);
      try {
        Dialog.show(
          player,
          WANTED_ACTION_DIALOG_ID,
          DIALOG_STYLE_LIST,
          playerChatName(target),
          "1. 查找\n2. 解除通缉",
          "选择",
          "取消"
        );
      } catch {
        pendingTarget.delete(officerId);
        player.sendClientMessage(Color.error, "无法打开菜单。");
      }
      return;
    }

    const picked = pendingTarget.get(officerId);
    pendingTarget.delete(officerId);
    if (!picked) {
      return;
    }

    const target = resolveTarget(picked);
    if (!target) {
      player.sendClientMessage(
        Color.error,
        "未找到玩家或该玩家已不再被通缉。"
      );
      return;
    }

    const action = Number(listItem);
    if (action === 0) {
      startPursuit(player, target);
      return;
    }

    if (action === 1) {
      const error = clearWantedByOfficer(player, target);
      if (error) {
        player.sendClientMessage(Color.error, error);
        return;
      }
      player.sendClientMessage(
        Color.info,
        `你已解除对玩家 ${playerChatName(target)} 的通缉。`
      );
    }
  });

  omp.on("playerDisconnect", (player) => {
    onOfficerGone(player);
    onTargetGone(player, "目标已离线，追踪已停止。");
  });

  omp.on("playerDeath", (player) => {
    onTargetGone(player, "目标已死亡，追踪已停止。");
  });
}

/** 目标解除通缉后，停止所有警员对其进行的追踪。 */
function stopPursuitsOfTarget(
  accountId: number | undefined,
  slot: number | null
): void {
  for (const [officerId, pursuit] of [...pursuits.entries()]) {
    const matchSlot = slot !== null && pursuit.targetSlot === slot;
    const matchAccount =
      accountId !== undefined && pursuit.targetAccountId === accountId;
    if (!matchSlot && !matchAccount) {
      continue;
    }

    const officer = findPlayer(officerId);
    if (officer) {
      stopPursuit(officer, officerId, "目标已解除通缉，追踪已停止。");
    } else {
      clearPursuitById(officerId);
    }
  }
}

function collectWantedOnline(): WantedRow[] {
  const rows: WantedRow[] = [];

  omp.players.forEach((other) => {
    if (!isPlayerActive(other) || !isAuthenticated(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    const account = getAccount(other);
    if (!account || account.wantedLevel <= 0) {
      return;
    }

    const slot = playerId(other);
    if (slot === null) {
      return;
    }

    rows.push({
      slot,
      accountId: account.id,
      wanted: account.wantedLevel,
      name: playerName(other),
      line: `${playerChatName(other)}\t${account.wantedLevel}`,
    });
  });

  rows.sort((a, b) => b.wanted - a.wanted || a.name.localeCompare(b.name));
  return rows;
}

function startPursuit(officer: Player, target: Player): void {
  const officerId = playerId(officer);
  const targetSlot = playerId(target);
  const targetAccount = getAccount(target);
  if (officerId === null || targetSlot === null || !targetAccount) {
    officer.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  if (targetSlot === officerId) {
    officer.sendClientMessage(Color.error, "不能跟踪自己。");
    return;
  }

  if (targetAccount.wantedLevel <= 0) {
    officer.sendClientMessage(Color.error, "该玩家没有被通缉。");
    return;
  }

  const hidden = trackBlockReason(target);
  if (hidden) {
    officer.sendClientMessage(Color.error, hidden);
    return;
  }

  stopPursuit(officer, officerId);

  const timer = setInterval(() => {
    tickPursuit(officerId);
  }, PURSUIT_TICK_MS);

  pursuits.set(officerId, {
    targetSlot,
    targetAccountId: targetAccount.id,
    timer,
  });

  if (!updatePursuitCheckpoint(officer, target)) {
    stopPursuit(officer, officerId, "无法开始追踪。");
    return;
  }

  officer.sendClientMessage(
    Color.info,
    `正在跟踪 ${playerChatName(target)}. 停止: /pursuit.`
  );
}

function tickPursuit(officerId: number): void {
  const pursuit = pursuits.get(officerId);
  if (!pursuit) {
    return;
  }

  const officer = findPlayer(officerId);
  if (!officer || !isAuthenticated(officer) || !isLawOfficer(officer)) {
    if (officer) {
      stopPursuit(officer, officerId);
    } else {
      clearPursuitById(officerId);
    }
    return;
  }

  const target = findPlayer(pursuit.targetSlot);
  const targetAccount = target ? getAccount(target) : null;
  if (!target || !targetAccount || targetAccount.id !== pursuit.targetAccountId) {
    stopPursuit(officer, officerId, "目标已离线，追踪已停止。");
    return;
  }

  if (targetAccount.wantedLevel <= 0) {
    stopPursuit(officer, officerId, "目标已解除通缉，追踪已停止。");
    return;
  }

  try {
    if (target.getState() === PLAYER_STATE_WASTED) {
      stopPursuit(officer, officerId, "目标已死亡，追踪已停止。");
      return;
    }
  } catch {
    stopPursuit(officer, officerId, "目标已离线，追踪已停止。");
    return;
  }

  const hidden = trackBlockReason(target);
  if (hidden) {
    stopPursuit(officer, officerId, "目标已逃脱，追踪已停止。");
    return;
  }

  updatePursuitCheckpoint(officer, target);
}

/** `null` 表示可以追踪（室外，VW 0）。 */
function trackBlockReason(target: Player): string | null {
  try {
    if (target.getInterior() > 0) {
      return "无法追踪位于室内的玩家。";
    }

    if (target.getVirtualWorld() !== STREET_WORLD) {
      return "无法追踪位于虚拟世界中的玩家。";
    }

    return null;
  } catch {
    return "未找到玩家。";
  }
}

function updatePursuitCheckpoint(officer: Player, target: Player): boolean {
  try {
    const pos = target.getPos();
    Checkpoint.set(officer, pos.x, pos.y, pos.z, CHECKPOINT_RADIUS);
    return true;
  } catch {
    return false;
  }
}

function stopPursuit(
  officer: Player,
  officerId: number,
  message?: string
): void {
  clearPursuitById(officerId);
  try {
    Checkpoint.disable(officer);
  } catch {
    // 已离线。
  }

  if (message) {
    try {
      if (isPlayerActive(officer)) {
        officer.sendClientMessage(Color.info, message);
      }
    } catch {
      // 槽位为空。
    }
  }
}

function clearPursuitById(officerId: number): void {
  const pursuit = pursuits.get(officerId);
  if (!pursuit) {
    return;
  }

  clearInterval(pursuit.timer);
  pursuits.delete(officerId);
}

function onOfficerGone(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  clearPending(player);
  clearPursuitById(id);
}

function onTargetGone(player: Player, message: string): void {
  const targetSlot = playerId(player);
  const accountId = getAccount(player)?.id;
  if (targetSlot === null) {
    return;
  }

  for (const [officerId, pursuit] of [...pursuits.entries()]) {
    const matchSlot = pursuit.targetSlot === targetSlot;
    const matchAccount =
      accountId !== undefined && pursuit.targetAccountId === accountId;
    if (!matchSlot && !matchAccount) {
      continue;
    }

    const officer = findPlayer(officerId);
    if (officer) {
      stopPursuit(officer, officerId, message);
    } else {
      clearPursuitById(officerId);
    }
  }
}

function clearPending(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    pendingTarget.delete(id);
    wantedLists.delete(id);
  }
}

function resolveTarget(picked: PendingTarget): Player | null {
  const target = findPlayer(picked.slot);
  const account = target ? getAccount(target) : null;
  if (!target || !account || account.id !== picked.accountId) {
    return null;
  }

  if (account.wantedLevel <= 0) {
    return null;
  }

  return target;
}

function findPlayer(slot: number): Player | null {
  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target)) {
    return null;
  }

  try {
    if (target.isNPC()) {
      return null;
    }
  } catch {
    return null;
  }

  return target;
}
