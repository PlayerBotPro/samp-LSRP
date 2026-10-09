import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { offerDocShow, registerDocShowHandler } from "../../shared/doc-show-offer";
import { WHISPER_RADIUS, arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import { byGender } from "../auth/gender";
import { saveUserMilitaryId } from "../auth/repository";
import { getAccount, isAuthenticated, patchAccount, type Account } from "../auth/session";
import { ORG_ARMY_ID, getMembership } from "../org";
import { registerCommand } from "./registry";

export const VBILET_DIALOG_ID = 67;

const DIALOG_STYLE_MSGBOX = 0;
const ISSUE_MIN_RANK = 8;
const TITLE = "{FFCC00}";
const LABEL = "{FFFFFF}";
const VALUE = "{33CCFF}";

registerDocShowHandler("vbilet", (viewer, owner) => {
  const account = getAccount(owner);
  if (!account?.militaryId) {
    viewer.sendClientMessage(Color.error, "该玩家没有军人证。");
    return;
  }

  showMilitaryId(viewer, account);
  const verb = byGender(account.gender, "出示了", "出示了");
  owner.sendClientMessage(
    Color.gray,
    `你${verb}了军人证: ${playerName(viewer)}.`
  );
  viewer.sendClientMessage(
    Color.gray,
    `${account.name} ${verb}了你的军人证。`
  );
});

registerCommand("vbilet", "查看军人证或按 ID 向他人出示", (player, args) => {
  const account = getAccount(player);
  if (!account) {
    player.sendClientMessage(Color.error, "请先登录账号。");
    return;
  }

  if (!account.militaryId) {
    player.sendClientMessage(Color.error, "你没有军人证。");
    return;
  }

  const rawId = args.trim();
  if (!rawId) {
    showMilitaryId(player, account);
    return;
  }

  const slot = Number(rawId);
  if (!Number.isInteger(slot) || slot < 0) {
    player.sendClientMessage(Color.error, "用法: /vbilet [id]");
    return;
  }

  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
    player.sendClientMessage(Color.error, "未找到玩家。");
    return;
  }

  if (playerId(target) === playerId(player)) {
    showMilitaryId(player, account);
    return;
  }

  if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远。");
    return;
  }

  offerDocShow(player, target, "vbilet", account.id);
});

registerCommand(
  "givevbilet",
  "签发军人证（军队，等级 8+）",
  (player, args) => {
    const account = getAccount(player);
    const membership = account ? getMembership(account) : null;
    if (
      !account ||
      !membership ||
      membership.org.id !== ORG_ARMY_ID ||
      membership.rank.id < ISSUE_MIN_RANK
    ) {
      player.sendClientMessage(
        Color.error,
        "只有军队 8 级及以上员工才能发放军人证。"
      );
      return;
    }

    const slot = Number(args.trim());
    if (!Number.isInteger(slot) || slot < 0) {
      player.sendClientMessage(Color.error, "用法: /givevbilet [id]");
      return;
    }

    const target = omp.players.at(slot);
    if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
      player.sendClientMessage(Color.error, "未找到玩家。");
      return;
    }

    if (playerId(target) === playerId(player)) {
      player.sendClientMessage(Color.error, "不能给自己发放军人证。");
      return;
    }

    const targetAccount = getAccount(target);
    if (!targetAccount) {
      player.sendClientMessage(Color.error, "未找到玩家。");
      return;
    }

    if (targetAccount.militaryId) {
      player.sendClientMessage(Color.error, "该玩家已经有军人证。");
      return;
    }

    patchAccount(target, { militaryId: true });
    void saveUserMilitaryId(targetAccount.id, true).catch(() => {
      // 缓存已更新。
    });

    player.sendClientMessage(
      Color.info,
      `你已向玩家 ${playerName(target)} 发放军人证。`
    );
    target.sendClientMessage(
      Color.info,
      `${playerName(player)} 给了你军人证。查看: /vbilet`
    );
  }
);

function showMilitaryId(viewer: Player, owner: Account): void {
  const served = byGender(owner.gender, "已服役", "已服役");
  const body = [
    row("姓名", owner.name),
    row("状态", "军人证已签发"),
    row("服役记录", served),
  ].join("\n");

  try {
    Dialog.show(
      viewer,
      VBILET_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}军人证 ${owner.name}`,
      body,
      "关闭",
      ""
    );
  } catch {
    viewer.sendClientMessage(Color.error, "无法打开军人证。");
  }
}

function row(label: string, value: string): string {
  return `${LABEL}${label}:\t\t${VALUE}${value}`;
}
