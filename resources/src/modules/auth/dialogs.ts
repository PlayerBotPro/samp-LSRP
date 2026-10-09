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
    "Accept",
    "Decline"
  );
}

export function showLoginDialog(player: Player, name: string, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  const body = [
    prefix + `Welcome to ${SERVER_NAME}`,
    "An account with this name already exists.",
    "",
    `Account: {33FF33}${name}{FFFFFF}`,
    "",
    "Enter your password:",
  ].join("\n");

  showAuthDialog(
    player,
    DialogStyle.password,
    "Login",
    body,
    "Log in",
    "Exit"
  );
}

export function showEmailDialog(player: Player, name: string, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  showAuthDialog(
    player,
    DialogStyle.input,
    "Registration",
    `${prefix}The name {33FF33}${name}{FFFFFF} is available.\nEnter your email address:`,
    "Next",
    "Back"
  );
}

export function showPasswordDialog(player: Player, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  const body = [
    prefix + `Welcome to ${SERVER_NAME}`,
    "Create an account to start playing.",
    "",
    "Choose a password for your account.",
    "You will need it each time you join the server.",
    "",
    "{33FF33}Notes:",
    "- Your password may contain Cyrillic and Latin characters",
    "- Your password is case-sensitive",
    "- Your password must not contain spaces",
    "- Your password must be 6 to 32 characters long",
  ].join("\n");

  showAuthDialog(
    player,
    DialogStyle.password,
    "Registration",
    body,
    "Next",
    "Back"
  );
}

export function showPasswordConfirmDialog(player: Player, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  showAuthDialog(
    player,
    DialogStyle.password,
    "Registration",
    `${prefix}Enter your password again:`,
    "Next",
    "Back"
  );
}

export function showBirthDateDialog(player: Player, error?: string): void {
  const prefix = error ? `{FF6347}${error}{FFFFFF}\n\n` : "";
  showAuthDialog(
    player,
    DialogStyle.input,
    "Registration",
    `${prefix}Date of birth (DD.MM.YYYY):\nExample: 15.04.1998`,
    "Next",
    "Back"
  );
}

export function showGenderDialog(player: Player): void {
  showAuthDialog(
    player,
    DialogStyle.list,
    "Character gender",
    `${GENDER_LIST_MALE}\n${GENDER_LIST_FEMALE}`,
    "Select",
    "Back"
  );
}

export function showSkinDialog(player: Player, gender: Gender): void {
  showAuthDialog(
    player,
    DialogStyle.list,
    "Choose a skin",
    skinListBody(gender),
    "Select",
    "Back"
  );
}

export function showRegisterConfirmDialog(player: Player, body: string): void {
  showAuthDialog(
    player,
    DialogStyle.msgbox,
    "Confirmation",
    body,
    "Finish",
    "Back"
  );
}
