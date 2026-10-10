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
    viewer.sendClientMessage(Color.error, "该玩家没有护照.");
    return;
  }

  showPassport(viewer, account);
  const verb = byGender(account.gender, "出示了", "出示了");
  owner.sendClientMessage(Color.gray, `你${verb}了护照: ${playerName(viewer)}.`);
  viewer.sendClientMessage(Color.gray, `${account.name} ${verb}了你的护照.`);
});

registerCommand("pass", "查看护照或按 ID 向他人出示", (player, args) => {
  const account = getAccount(player);
  if (!account) {
    player.sendClientMessage(Color.error, "请先登录账号.");
    return;
  }

  if (!account.passport) {
    player.sendClientMessage(
      Color.error,
      "你没有护照.请前往市政厅办理."
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
    player.sendClientMessage(Color.error, "未找到玩家.");
    return;
  }

  if (playerId(target) === playerId(player)) {
    showPassport(player, account);
    return;
  }

  if (!getAccount(target)) {
    player.sendClientMessage(Color.error, "未找到玩家.");
    return;
  }

  if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远.");
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
    passRow("姓名", owner.name),
    passRow("住所", residenceLabel(owner.id)),
    passRow("居住年限", String(ageFromBirthDate(owner.birthDate))),
    passRow("性别", genderLabel(owner.gender)),
    passRow("出生日期", formatBirthDate(owner.birthDate)),
    passRow("组织", membership?.org.name ?? "无"),
    passRow("职位", membership?.rank.title ?? "无"),
    passRow("职业", jobLabel(owner.jobId, owner.gender)),
    passRow("守法值", String(owner.lawfulness)),
  ].join("\n");

  try {
    Dialog.show(
      viewer,
      PASSPORT_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}护照 ${owner.name}`,
      body,
      "关闭",
      ""
    );
  } catch {
    viewer.sendClientMessage(Color.error, "无法打开护照.");
  }
}
