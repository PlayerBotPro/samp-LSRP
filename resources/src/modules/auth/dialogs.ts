import { Dialog, type Player } from "@omp-node/core";
import { SERVER_NAME } from "../../shared/brand";
import { Color } from "../../shared/colors";
import { isPlayerActive, kickSamePlayer } from "../../shared/player";
import { DEFAULT_SPAWN, STREET_WORLD } from "../spawn/point";
import { GENDER_LIST_FEMALE, GENDER_LIST_MALE, type Gender } from "./gender";
import { RULES_TITLE, SERVER_RULES } from "./rules";
import { isAuthenticated } from "./session";
import { skinListBody } from "./skins";

export const AUTH_DIALOG_ID = 1;

export const DialogStyle = {
  msgbox: 0,
  input: 1,
  list: 2,
  password: 3,
} as const;

export function showAuthDialog(
  player: Player,
  style: number,
  title: string,
  body: string,
  button1: string,
  button2: string
): void {
  try {
    Dialog.show(player, AUTH_DIALOG_ID, style, title, body, button1, button2);
  } catch {
    // Игрок уже вышел.
  }
}

export function prepareAuthView(player: Player): void {
  player.setInterior(0);
  player.setVirtualWorld(STREET_WORLD);
  player.setPos(DEFAULT_SPAWN.x, DEFAULT_SPAWN.y, DEFAULT_SPAWN.z);
  player.toggleSpectating(true);
  player.setCameraPos(1779.37, -1932.56, 22.0);
  player.setCameraLookAt(DEFAULT_SPAWN.x, DEFAULT_SPAWN.y, DEFAULT_SPAWN.z, 2);
}

export function refreshAuthViewSoon(player: Player): void {
  for (const delay of [80, 400]) {
    setTimeout(() => {
      if (!isPlayerActive(player) || isAuthenticated(player)) {
        return;
      }

      try {
        prepareAuthView(player);
      } catch {
        // Слот ещё не готов.
      }
    }, delay);
  }
}

export function kickLater(player: Player, reason: string): void {
  player.sendClientMessage(Color.error, reason);
  kickSamePlayer(player);
}

export function showRulesDialog(player: Player): void {
  showAuthDialog(
    player,
    DialogStyle.msgbox,
    RULES_TITLE,
    SERVER_RULES,
    "接受",
    "拒绝"
  );
}

export function showLoginDialog(player: Player, name: string, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  const body = [
    prefix + `欢迎来到 ${SERVER_NAME}`,
    "此角色名已注册。",
    "",
    `账号：{33FF33}${name}{FFFFFF}`,
    "",
    "请输入密码：",
  ].join("\n");

  showAuthDialog(
    player,
    DialogStyle.password,
    "登录",
    body,
    "登录",
    "退出"
  );
}

export function showEmailDialog(player: Player, name: string, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  showAuthDialog(
    player,
    DialogStyle.input,
    "注册",
    `${prefix}角色名 {33FF33}${name}{FFFFFF} 可以使用。\n请输入电子邮箱：`,
    "下一步",
    "返回"
  );
}

export function showPasswordDialog(player: Player, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  const body = [
    prefix + `欢迎来到 ${SERVER_NAME}`,
    "创建账号后即可开始游戏。",
    "",
    "请为账号设置密码。",
    "每次登录服务器都需要输入此密码。",
    "",
    "{33FF33}密码要求：",
    "- 可使用西里尔字母和拉丁字母",
    "- 区分大小写",
    "- 不得包含空格",
    "- 长度为 6 至 32 个字符",
  ].join("\n");

  showAuthDialog(
    player,
    DialogStyle.password,
    "注册",
    body,
    "下一步",
    "返回"
  );
}

export function showPasswordConfirmDialog(player: Player, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  showAuthDialog(
    player,
    DialogStyle.password,
    "注册",
    `${prefix}请再次输入密码：`,
    "下一步",
    "返回"
  );
}

export function showBirthDateDialog(player: Player, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  showAuthDialog(
    player,
    DialogStyle.input,
    "注册",
    `${prefix}出生日期（日.月.年）：\n例如：15.04.1998`,
    "下一步",
    "返回"
  );
}

export function showGenderDialog(player: Player): void {
  showAuthDialog(
    player,
    DialogStyle.list,
    "角色性别",
    `${GENDER_LIST_MALE}\n${GENDER_LIST_FEMALE}`,
    "选择",
    "返回"
  );
}

export function showSkinDialog(player: Player, gender: Gender): void {
  showAuthDialog(
    player,
    DialogStyle.list,
    "选择角色外观",
    skinListBody(gender),
    "选择",
    "返回"
  );
}

export function showRegisterConfirmDialog(player: Player, body: string): void {
  showAuthDialog(
    player,
    DialogStyle.msgbox,
    "确认信息",
    body,
    "完成",
    "返回"
  );
}
