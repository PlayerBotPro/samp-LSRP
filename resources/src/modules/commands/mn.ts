import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { SERVER_TAG } from "../../shared/brand";
import { isPlayerActive } from "../../shared/player";
import { RULES_TITLE, SERVER_RULES } from "../auth/rules";
import { findUserByName, saveUserInvitedBy } from "../auth/repository";
import { getAccount, patchAccount } from "../auth/session";
import { isRoleplayName } from "../auth/validation";
import { showHelpMenu } from "./help";
import { registerCommand } from "./registry";
import { showReportDialog } from "./report";
import { showStatsDialog } from "./stats";

export const MENU_DIALOG_ID = 4;
export const RULES_DIALOG_ID = 5;
export const INVITE_DIALOG_ID = 6;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_INPUT = 1;
const DIALOG_STYLE_LIST = 2;

type MenuKey = "stats" | "commands" | "rules" | "report" | "invite";

const MENU_ITEMS: Record<MenuKey, string> = {
  stats: "统计",
  commands: "命令列表",
  rules: "服务器规则",
  report: "联系管理员",
  invite: "邀请人",
};

registerCommand("mn", "菜单:统计,命令,规则", (player) => {
  showMenu(player);
});

export function bindMenuDialogs(): void {
  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    const id = Number(dialogId);
    const ok = Number(response) !== 0;
    const input = String(inputText ?? "");

    if (id === MENU_DIALOG_ID) {
      if (!ok) {
        return;
      }

      const item = menuItem(player, Number(listItem), input);
      if (item === "stats") {
        showStatsDialog(player);
        return;
      }

      if (item === "commands") {
        showHelpMenu(player);
        return;
      }

      if (item === "rules") {
        showRulesDialog(player);
        return;
      }

      if (item === "invite") {
        showInviteDialog(player);
        return;
      }

      if (item === "report") {
        showReportDialog(player);
      }
      return;
    }

    if (id === INVITE_DIALOG_ID) {
      if (!ok) {
        return;
      }

      void submitInvite(player, input);
    }
  });
}

function visibleMenuKeys(player: Player): MenuKey[] {
  const keys: MenuKey[] = ["stats", "commands", "rules", "report"];
  const account = getAccount(player);
  if (account && !account.invitedBy) {
    keys.push("invite");
  }

  return keys;
}

function showMenu(player: Player): void {
  const body = visibleMenuKeys(player)
    .map((key, index) => `${index + 1}. ${MENU_ITEMS[key]}`)
    .join("\n");

  try {
    Dialog.show(
      player,
      MENU_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "菜单",
      body,
      "选择",
      "关闭"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开菜单.");
  }
}

function showRulesDialog(player: Player): void {
  try {
    Dialog.show(
      player,
      RULES_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      RULES_TITLE,
      SERVER_RULES,
      "关闭",
      ""
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开规则.");
  }
}

function showInviteDialog(player: Player, error?: string): void {
  const account = getAccount(player);
  if (!account || account.invitedBy) {
    return;
  }

  const prefix = error ? `${error}\n\n` : "";
  try {
    Dialog.show(
      player,
      INVITE_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "邀请人",
      `${prefix}请输入邀请你的玩家昵称.\n格式:Name_Surname`,
      "保存",
      "取消"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开表格.");
  }
}

function menuItem(player: Player, listItem: number, inputText: string): MenuKey | null {
  const keys = visibleMenuKeys(player);
  const raw = inputText.trim().toLowerCase();

  for (const key of keys) {
    if (raw === MENU_ITEMS[key].toLowerCase()) {
      return key;
    }
  }

  return keys[listItem] ?? null;
}

async function submitInvite(player: Player, raw: string): Promise<void> {
  const account = getAccount(player);
  if (!account || !isPlayerActive(player)) {
    return;
  }

  if (account.invitedBy) {
    player.sendClientMessage(Color.gray, "邀请人已经填写.");
    return;
  }

  const nick = raw.trim();
  if (!nick) {
    showInviteDialog(player, "请输入昵称.");
    return;
  }

  if (!isRoleplayName(nick)) {
    showInviteDialog(player, "昵称格式应为 Name_Surname.");
    return;
  }

  if (nick.toLowerCase() === account.name.toLowerCase()) {
    showInviteDialog(player, "不能填写自己.");
    return;
  }

  try {
    const row = await findUserByName(nick);
    if (!isPlayerActive(player)) {
      return;
    }

    const live = getAccount(player);
    if (!live || live.invitedBy) {
      return;
    }

    if (!row) {
      showInviteDialog(player, "该昵称未注册.");
      return;
    }

    const saved = await saveUserInvitedBy(live.id, row.name);
    if (!isPlayerActive(player)) {
      return;
    }

    if (!saved) {
      player.sendClientMessage(Color.gray, "邀请人已经填写.");
      return;
    }

    patchAccount(player, { invitedBy: row.name });
    player.sendClientMessage(
      Color.info,
      `已保存邀请人: ${row.name}.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] 推荐系统错误 ${account.name}:${message}`);
    if (isPlayerActive(player)) {
      player.sendClientMessage(
        Color.error,
        "无法保存.请稍后重试."
      );
    }
  }
}
