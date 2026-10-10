import { Dialog, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { CHAT_RADIUS, sendNearby } from "../../shared/nearby";
import { playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getAccount } from "../auth/session";
import { resolveLawNearbyTarget } from "./law-target";
import { registerCommand } from "./registry";

export const FRISK_DIALOG_ID = 140;

const DIALOG_STYLE_MSGBOX = 0;
const LABEL = "{FFFFFF}";
const VALUE = "{33CCFF}";
const EMPTY = "{AAAAAA}";

registerCommand("frisk", "搜查玩家(警察 / FBI)", (player, args) => {
  const resolved = resolveLawNearbyTarget(
    player,
    args,
    "用法: /frisk [id]"
  );
  if (!resolved.ok) {
    return;
  }

  const { officer, target } = resolved;
  const account = getAccount(target);
  if (!account) {
    officer.sendClientMessage(Color.error, "未找到玩家.");
    return;
  }

  if (!showFriskResult(officer, account.name, account)) {
    return;
  }

  const frisked = byGender(
    getAccount(officer)?.gender ?? null,
    "搜查了",
    "搜查了"
  );
  sendNearby(
    officer,
    CHAT_RADIUS,
    Color.action,
    `${playerName(officer)} 仔细搜查了 ${playerName(target)}.`
  );

  try {
    target.sendClientMessage(Color.gray, `${playerName(officer)} 正在搜查你.`);
  } catch {
    // 已离线.
  }
});

function showFriskResult(
  viewer: Player,
  ownerName: string,
  account: {
    phone: string | null;
    metal: number;
    drugs: number;
    ammo: number;
  }
): boolean {
  const body = [
    row("电话", account.phone ? account.phone : "无", !account.phone),
    row("金属", `${account.metal} 件`, account.metal <= 0),
    row("毒品", `${account.drugs} 件`, account.drugs <= 0),
    row("弹药", `${account.ammo} 件`, account.ammo <= 0),
  ].join("\n");

  try {
    Dialog.show(
      viewer,
      FRISK_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `{FFCC00}搜查:${ownerName}`,
      body,
      "关闭",
      ""
    );
    return true;
  } catch {
    viewer.sendClientMessage(Color.error, "无法打开搜查结果.");
    return false;
  }
}

function row(label: string, value: string, empty: boolean): string {
  return `${LABEL}${label}:\t\t${empty ? EMPTY : VALUE}${value}`;
}
