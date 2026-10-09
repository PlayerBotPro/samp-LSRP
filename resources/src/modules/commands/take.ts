import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_RADIUS, WHISPER_RADIUS, arePlayersNearby, sendNearby } from "../../shared/nearby";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import {
  LICENSE_ROWS,
  type LicenseKey,
  type Licenses,
} from "../auth/licenses";
import { saveUserInventory, saveUserLicenses } from "../auth/repository";
import { getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { canLawSearchTarget, isLawOfficer } from "../org/law";
import { isJailed } from "../prison/sentence";
import { resolveLawNearbyTarget } from "./law-target";
import { registerCommand } from "./registry";

export const TAKE_DIALOG_ID = 141;

const DIALOG_STYLE_LIST = 2;
const PLAYER_STATE_WASTED = 7;

type TakeItem =
  | { kind: "drugs"; label: string }
  | { kind: "ammo"; label: string }
  | { kind: "license"; key: LicenseKey; label: string };

type PendingTake = {
  targetSlot: number;
  targetAccountId: number;
  items: TakeItem[];
};

const pending = new Map<number, PendingTake>();
/** Один apply на офицера — иначе параллельные saveUserInventory перетирают друг друга. */
const busy = new Set<number>();

registerCommand("take", "Изъять предметы у игрока (полиция / FBI)", (player, args) => {
  const resolved = resolveLawNearbyTarget(
    player,
    args,
    "Использование: /take [id]"
  );
  if (!resolved.ok) {
    return;
  }

  const { officer, target, officerId, targetId } = resolved;
  if (busy.has(officerId)) {
    officer.sendClientMessage(Color.error, "请等待上一次没收操作完成。");
    return;
  }

  const account = getAccount(target);
  if (!account) {
    officer.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  const items = buildTakeItems(account);
  if (items.length === 0) {
    officer.sendClientMessage(Color.error, "该玩家没有可没收的物品。");
    return;
  }

  pending.set(officerId, {
    targetSlot: targetId,
    targetAccountId: account.id,
    items,
  });

  const lines = items.map((item, index) => `${index + 1}. ${item.label}`);

  try {
    Dialog.show(
      officer,
      TAKE_DIALOG_ID,
      DIALOG_STYLE_LIST,
      `{FFCC00}Изъятие: ${account.name}`,
      lines.join("\n"),
      "Изъять",
      "Отмена"
    );
  } catch {
    pending.delete(officerId);
    officer.sendClientMessage(Color.error, "无法打开没收列表。");
  }
});

export function bindTakeDialogs(): void {
  omp.on("dialogResponse", (player, dialogId, response, listItem) => {
    if (Number(dialogId) !== TAKE_DIALOG_ID) {
      return;
    }

    const officerId = playerId(player);
    if (officerId === null) {
      return;
    }

    const session = pending.get(officerId);
    pending.delete(officerId);
    if (!session || Number(response) === 0) {
      return;
    }

    if (!isAuthenticated(player) || !isLawOfficer(player)) {
      return;
    }

    if (isJailed(player)) {
      player.sendClientMessage(Color.error, "在监狱里无法使用此命令。");
      return;
    }

    if (busy.has(officerId)) {
      player.sendClientMessage(Color.error, "请等待上一次没收操作完成。");
      return;
    }

    const item = session.items[Number(listItem)];
    if (!item) {
      return;
    }

    busy.add(officerId);
    void applyTake(player, session, item).finally(() => {
      busy.delete(officerId);
    });
  });

  omp.on("playerDisconnect", (player) => {
    const id = playerId(player);
    if (id !== null) {
      pending.delete(id);
      busy.delete(id);
    }
  });
}

async function applyTake(
  officer: Player,
  session: PendingTake,
  item: TakeItem
): Promise<void> {
  const target = omp.players.at(session.targetSlot);
  if (
    !target ||
    !isPlayerActive(target) ||
    !isAuthenticated(target) ||
    getAccount(target)?.id !== session.targetAccountId
  ) {
    officer.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  try {
    if (target.getState() === PLAYER_STATE_WASTED) {
      officer.sendClientMessage(Color.error, "玩家不在线。");
      return;
    }
  } catch {
    officer.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
    officer.sendClientMessage(Color.error, "玩家距离太远。");
    return;
  }

  if (!canLawSearchTarget(officer, target)) {
    officer.sendClientMessage(
      Color.error,
      "警察只能对平民使用此命令。FBI 可以对任何人使用。"
    );
    return;
  }

  const account = getAccount(target);
  if (!account) {
    return;
  }

  const took = byGender(getAccount(officer)?.gender ?? null, "изъял", "изъяла");

  if (item.kind === "drugs") {
    if (account.drugs <= 0) {
      officer.sendClientMessage(Color.error, "该玩家没有毒品。");
      return;
    }

    const amount = account.drugs;
    patchAccount(target, { drugs: 0 });

    try {
      const live = getAccount(target);
      if (!live || live.id !== session.targetAccountId) {
        throw new Error("target gone");
      }
      await saveUserInventory(live.id, live.drugs, live.ammo, live.metal);
    } catch {
      patchAccount(target, { drugs: amount });
      officer.sendClientMessage(Color.error, "无法保存没收记录。");
      return;
    }

    roleplayTake(officer, target, took, `наркотики (${amount} шт.)`);
    return;
  }

  if (item.kind === "ammo") {
    if (account.ammo <= 0) {
      officer.sendClientMessage(Color.error, "该玩家没有子弹。");
      return;
    }

    const amount = account.ammo;
    patchAccount(target, { ammo: 0 });

    try {
      const live = getAccount(target);
      if (!live || live.id !== session.targetAccountId) {
        throw new Error("target gone");
      }
      await saveUserInventory(live.id, live.drugs, live.ammo, live.metal);
    } catch {
      patchAccount(target, { ammo: amount });
      officer.sendClientMessage(Color.error, "无法保存没收记录。");
      return;
    }

    roleplayTake(officer, target, took, `патроны (${amount} шт.)`);
    return;
  }

  if (!account.licenses[item.key]) {
    officer.sendClientMessage(Color.error, "该玩家没有此执照。");
    return;
  }

  const prevLicenses: Licenses = { ...account.licenses };
  const nextLicenses: Licenses = { ...account.licenses, [item.key]: false };
  patchAccount(target, { licenses: nextLicenses });

  try {
    await saveUserLicenses(account.id, nextLicenses);
  } catch {
    patchAccount(target, { licenses: prevLicenses });
    officer.sendClientMessage(Color.error, "无法保存没收记录。");
    return;
  }

  roleplayTake(
    officer,
    target,
    took,
    `лицензию (${item.label.replace(/^Лицензия:\s*/, "")})`
  );
}

function roleplayTake(
  officer: Player,
  target: Player,
  verb: string,
  what: string
): void {
  sendNearby(
    officer,
    CHAT_RADIUS,
    Color.action,
    `${playerName(officer)} ${verb} у ${playerName(target)} ${what}.`
  );

  try {
    target.sendClientMessage(
      Color.error,
      `${playerName(officer)} ${verb}了你的${what}.`
    );
  } catch {
    // Уже вышел.
  }

  officer.sendClientMessage(Color.info, `你没收了${what}.`);
}

function buildTakeItems(account: {
  drugs: number;
  ammo: number;
  licenses: Licenses;
}): TakeItem[] {
  const items: TakeItem[] = [];
  if (account.drugs > 0) {
    items.push({ kind: "drugs", label: `Наркотики (${account.drugs} шт.)` });
  }
  if (account.ammo > 0) {
    items.push({ kind: "ammo", label: `Патроны (${account.ammo} шт.)` });
  }
  for (const row of LICENSE_ROWS) {
    if (account.licenses[row.key]) {
      items.push({
        kind: "license",
        key: row.key,
        label: `Лицензия: ${row.label.toLowerCase()}`,
      });
    }
  }
  return items;
}
