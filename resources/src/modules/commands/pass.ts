import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { offerDocShow, registerDocShowHandler } from "../../shared/doc-show-offer";
import { WHISPER_RADIUS, arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import { byGender, genderLabel } from "../auth/gender";
import { getAccount, type Account } from "../auth/session";
import { ageFromBirthDate, formatBirthDate } from "../auth/validation";
import { residenceLabel } from "../houses/residence";
import { jobLabel } from "../jobs";
import { getMembership } from "../org";
import { registerCommand } from "./registry";

const PASSPORT_DIALOG_ID = 3;
const DIALOG_STYLE_MSGBOX = 0;
const TITLE = "{FFCC00}";
const LABEL = "{FFFFFF}";
const VALUE = "{33CCFF}";

registerDocShowHandler("pass", (viewer, owner) => {
  const account = getAccount(owner);
  if (!account?.passport) {
    viewer.sendClientMessage(Color.error, "该玩家没有护照。");
    return;
  }

  showPassport(viewer, account);
  const verb = byGender(account.gender, "показал", "показала");
  owner.sendClientMessage(Color.gray, `你${verb}了护照: ${playerName(viewer)}.`);
  viewer.sendClientMessage(Color.gray, `${account.name} ${verb}了你的护照。`);
});

registerCommand("pass", "Паспорт: посмотреть или показать по id", (player, args) => {
  const account = getAccount(player);
  if (!account) {
    player.sendClientMessage(Color.error, "请先登录账号。");
    return;
  }

  if (!account.passport) {
    player.sendClientMessage(
      Color.error,
      "你没有护照。请前往市政厅办理。"
    );
    return;
  }

  const rawId = args.trim();
  if (!rawId) {
    showPassport(player, account);
    return;
  }

  const slot = Number(rawId);
  if (!Number.isInteger(slot) || slot < 0) {
    player.sendClientMessage(Color.error, "用法: /pass [id]");
    return;
  }

  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target)) {
    player.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  if (playerId(target) === playerId(player)) {
    showPassport(player, account);
    return;
  }

  if (!getAccount(target)) {
    player.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远。");
    return;
  }

  offerDocShow(player, target, "pass", account.id);
});

function passRow(label: string, value: string): string {
  return `${LABEL}${label}:\t\t${VALUE}${value}`;
}

function showPassport(viewer: Player, owner: Account): void {
  const membership = getMembership(owner);
  const body = [
    passRow("Имя", owner.name),
    passRow("Проживание", residenceLabel(owner.id)),
    passRow("Проживание в стране (лет)", String(ageFromBirthDate(owner.birthDate))),
    passRow("Пол", genderLabel(owner.gender)),
    passRow("Дата рождения", formatBirthDate(owner.birthDate)),
    passRow("Организация", membership?.org.name ?? "Нет"),
    passRow("Должность", membership?.rank.title ?? "Нет"),
    passRow("Работа", jobLabel(owner.jobId, owner.gender)),
    passRow("Законопослушность", String(owner.lawfulness)),
  ].join("\n");

  try {
    Dialog.show(
      viewer,
      PASSPORT_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}Паспорт ${owner.name}`,
      body,
      "Закрыть",
      ""
    );
  } catch {
    viewer.sendClientMessage(Color.error, "无法打开护照。");
  }
}
