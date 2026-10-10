import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { offerDocShow, registerDocShowHandler } from "../../shared/doc-show-offer";
import { WHISPER_RADIUS, arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive, playerId, playerName } from "../../shared/player";
import {
  claimYnOffer,
  getYnOfferKind,
  releaseYnOffer,
} from "../../shared/yn-offer";
import { byGender } from "../auth/gender";
import { saveUserMedcard, saveUserMoney } from "../auth/repository";
import {
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
  type Account,
} from "../auth/session";
import { ORG_HOSPITAL_ID, getMembership } from "../org";
import { HOSPITAL_WORLD } from "../spawn/point";
import { registerCommand } from "./registry";

export const MEDCARD_DIALOG_ID = 68;

const DIALOG_STYLE_MSGBOX = 0;
const ISSUE_MIN_RANK = 6;
const MIN_PRICE = 2000;
const MAX_PRICE = 5000;
const ISSUE_RADIUS = 20;
const KEY_YES = 65536;
const KEY_NO = 131072;
const OFFER_TTL_MS = 60_000;
const TITLE = "{FFCC00}";
const LABEL = "{FFFFFF}";
const VALUE = "{33CCFF}";

/** 医院医疗卡签发区域(整个服务区,约 20 米). */
const ISSUE_POINT = {
  x: 1165.0743,
  y: -1350.3879,
  z: 4001.1001,
} as const;

type MedcardOffer = {
  issuerId: number;
  issuerUserId: number;
  price: number;
  expiresAt: number;
};

/** 医疗卡提议:目标槽位 → 提议. */
const pendingOffers = new Map<number, MedcardOffer>();

registerDocShowHandler("show_medcard", (viewer, owner) => {
  const account = getAccount(owner);
  if (!account?.medcard) {
    viewer.sendClientMessage(Color.error, "该玩家没有医疗卡.");
    return;
  }

  showMedcard(viewer, account);
  const verb = byGender(account.gender, "出示了", "出示了");
  owner.sendClientMessage(Color.gray, `你${verb}了医疗卡: ${playerName(viewer)}.`);
  viewer.sendClientMessage(Color.gray, `${account.name} ${verb}了你的医疗卡.`);
});

registerCommand("medcard", "查看医疗卡或按 ID 向他人出示", (player, args) => {
  const account = getAccount(player);
  if (!account) {
    player.sendClientMessage(Color.error, "请先登录账号.");
    return;
  }

  if (!account.medcard) {
    player.sendClientMessage(Color.error, "你没有医疗卡.");
    return;
  }

  const rawId = args.trim();
  if (!rawId) {
    showMedcard(player, account);
    return;
  }

  const slot = Number(rawId);
  if (!Number.isInteger(slot) || slot < 0) {
    player.sendClientMessage(Color.error, "用法: /medcard [id]");
    return;
  }

  const target = omp.players.at(slot);
  if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
    player.sendClientMessage(Color.error, "未找到玩家.");
    return;
  }

  if (playerId(target) === playerId(player)) {
    showMedcard(player, account);
    return;
  }

  if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "玩家距离太远.");
    return;
  }

  offerDocShow(player, target, "show_medcard", account.id);
});

registerCommand(
  "givemedcard",
  "签发医疗卡(医院,等级 6+)",
  (player, args) => {
    const account = getAccount(player);
    const membership = account ? getMembership(account) : null;
    if (
      !account ||
      !membership ||
      membership.org.id !== ORG_HOSPITAL_ID ||
      membership.rank.id < ISSUE_MIN_RANK
    ) {
      player.sendClientMessage(
        Color.error,
        "只有医院 6 级及以上员工才能发放医疗卡."
      );
      return;
    }

    if (!isInMedcardIssueZone(player)) {
      player.sendClientMessage(
        Color.error,
        "只能在医院发放医疗卡."
      );
      return;
    }

    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      player.sendClientMessage(
        Color.error,
        `用法: /givemedcard [id] [金额 ${MIN_PRICE}-${MAX_PRICE}]`
      );
      return;
    }

    const slot = Number(parts[0]);
    const price = Math.floor(Number(parts[1]));
    if (!Number.isInteger(slot) || slot < 0) {
      player.sendClientMessage(Color.error, "玩家 ID 无效.");
      return;
    }

    if (
      !Number.isFinite(price) ||
      !Number.isSafeInteger(price) ||
      price < MIN_PRICE ||
      price > MAX_PRICE
    ) {
      player.sendClientMessage(
        Color.error,
        `金额必须在 $${MIN_PRICE} 到 $${MAX_PRICE} 之间.`
      );
      return;
    }

    const target = omp.players.at(slot);
    if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
      player.sendClientMessage(Color.error, "未找到玩家.");
      return;
    }

    const issuerSlot = playerId(player);
    const targetSlot = playerId(target);
    if (issuerSlot === null || targetSlot === null) {
      return;
    }

    if (targetSlot === issuerSlot) {
      player.sendClientMessage(Color.error, "不能给自己发放医疗卡.");
      return;
    }

    if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
      player.sendClientMessage(Color.error, "玩家距离太远.");
      return;
    }

    const targetAccount = getAccount(target);
    if (!targetAccount) {
      player.sendClientMessage(Color.error, "未找到玩家.");
      return;
    }

    if (targetAccount.medcard) {
      player.sendClientMessage(Color.error, "该玩家已经有医疗卡.");
      return;
    }

    if (targetAccount.money < price) {
      player.sendClientMessage(
        Color.error,
        `该玩家资金不足.需要 $${price}.`
      );
      return;
    }

    if (pendingOffers.has(targetSlot) || !claimYnOffer(targetSlot, "medcard")) {
      player.sendClientMessage(Color.error, "该玩家已有有效报价.");
      return;
    }

    pendingOffers.set(targetSlot, {
      issuerId: issuerSlot,
      issuerUserId: account.id,
      price,
      expiresAt: Date.now() + OFFER_TTL_MS,
    });

    player.sendClientMessage(
      Color.info,
      `你向玩家 ${playerName(target)} 提议以 $${price} 购买医疗卡.`
    );
    target.sendClientMessage(
      Color.white,
      `${playerName(player)} 提议以 $${price} 出售医疗卡.`
    );
    target.sendClientMessage(
      Color.white,
      "按 {00CC00}Y {FFFFFF}查看,或按 {FF6600}N {FFFFFF}拒绝"
    );
  }
);

export function bindMedcardOffers(): void {
  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const slot = playerId(player);
    if (slot === null || getYnOfferKind(slot) !== "medcard") {
      return;
    }

    const offer = pendingOffers.get(slot);
    if (!offer) {
      releaseYnOffer(slot, "medcard");
      return;
    }

    if (Date.now() > offer.expiresAt) {
      pendingOffers.delete(slot);
      releaseYnOffer(slot, "medcard");
      player.sendClientMessage(Color.error, "医疗卡报价已过期.");
      return;
    }

    if ((pressed & KEY_NO) !== 0) {
      refuseOffer(player, slot, offer);
      return;
    }

    if ((pressed & KEY_YES) !== 0) {
      acceptOffer(player, slot, offer);
    }
  });

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    if (slot === null) {
      return;
    }

    if (pendingOffers.has(slot)) {
      pendingOffers.delete(slot);
      releaseYnOffer(slot, "medcard");
    }
    for (const [targetSlot, offer] of pendingOffers) {
      if (offer.issuerId === slot) {
        pendingOffers.delete(targetSlot);
        releaseYnOffer(targetSlot, "medcard");
      }
    }
  });
}

function acceptOffer(target: Player, targetSlot: number, offer: MedcardOffer): void {
  pendingOffers.delete(targetSlot);
  releaseYnOffer(targetSlot, "medcard");

  const targetAccount = getAccount(target);
  if (!targetAccount || !isAuthenticated(target)) {
    return;
  }

  if (targetAccount.medcard) {
    target.sendClientMessage(Color.error, "你已经有医疗卡.");
    return;
  }

  const issuer = omp.players.at(offer.issuerId);
  if (!issuer || !isPlayerActive(issuer) || !isAuthenticated(issuer)) {
    target.sendClientMessage(Color.error, "医生已退出游戏.交易已取消.");
    return;
  }

  const issuerAccount = getAccount(issuer);
  if (!issuerAccount || issuerAccount.id !== offer.issuerUserId) {
    target.sendClientMessage(Color.error, "医生已退出游戏.交易已取消.");
    return;
  }

  if (!arePlayersNearby(target, issuer, WHISPER_RADIUS)) {
    target.sendClientMessage(Color.error, "医生距离太远.交易已取消.");
    issuer.sendClientMessage(Color.error, "患者距离太远.交易已取消.");
    return;
  }

  if (!isInMedcardIssueZone(issuer)) {
    target.sendClientMessage(Color.error, "医生必须在医院.交易已取消.");
    issuer.sendClientMessage(Color.error, "只能在医院发放医疗卡.");
    return;
  }

  const price = offer.price;
  if (targetAccount.money < price) {
    target.sendClientMessage(Color.error, `资金不足.需要 $${price}.`);
    issuer.sendClientMessage(
      Color.error,
      `${playerName(target)} 无法支付医疗卡费用 ($${price}).`
    );
    return;
  }

  const nextTargetMoney = targetAccount.money - price;
  const nextIssuerMoney = issuerAccount.money + price;
  if (!Number.isSafeInteger(nextIssuerMoney)) {
    target.sendClientMessage(Color.error, "无法完成付款.");
    return;
  }

  patchAccount(target, { money: nextTargetMoney, medcard: true });
  patchAccount(issuer, { money: nextIssuerMoney });

  const liveTarget = getAccount(target);
  const liveIssuer = getAccount(issuer);
  if (liveTarget) {
    applyWallet(target, liveTarget);
  }
  if (liveIssuer) {
    applyWallet(issuer, liveIssuer);
  }

  void Promise.all([
    saveUserMoney(targetAccount.id, nextTargetMoney, targetAccount.bank),
    saveUserMoney(issuerAccount.id, nextIssuerMoney, issuerAccount.bank),
    saveUserMedcard(targetAccount.id, true),
  ]).catch(() => {
    // 缓存已更新.
  });

  issuer.sendClientMessage(
    Color.info,
    `玩家 ${playerName(target)} 以 $${price} 购买了医疗卡.`
  );
  target.sendClientMessage(
    Color.info,
    `你以 $${price} 购买了医疗卡.查看: /medcard`
  );
  showMedcard(target, getAccount(target) ?? { ...targetAccount, medcard: true });
}

function refuseOffer(target: Player, targetSlot: number, offer: MedcardOffer): void {
  pendingOffers.delete(targetSlot);
  releaseYnOffer(targetSlot, "medcard");
  target.sendClientMessage(Color.gray, "你拒绝了医疗卡.");

  const issuer = omp.players.at(offer.issuerId);
  if (issuer && isPlayerActive(issuer)) {
    issuer.sendClientMessage(
      Color.gray,
      `${playerName(target)} 拒绝了医疗卡.`
    );
  }
}

function isInMedcardIssueZone(player: Player): boolean {
  try {
    if (player.getVirtualWorld() !== HOSPITAL_WORLD || player.getInterior() !== 0) {
      return false;
    }

    const pos = player.getPos();
    return (
      Math.hypot(pos.x - ISSUE_POINT.x, pos.y - ISSUE_POINT.y, pos.z - ISSUE_POINT.z) <=
      ISSUE_RADIUS
    );
  } catch {
    return false;
  }
}

function showMedcard(viewer: Player, owner: Account): void {
  const body = [
    row("姓名", owner.name),
    row("状态", "医疗卡已签发"),
    row("健康状况", "合格"),
  ].join("\n");

  try {
    Dialog.show(
      viewer,
      MEDCARD_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      `${TITLE}医疗卡 ${owner.name}`,
      body,
      "关闭",
      ""
    );
  } catch {
    viewer.sendClientMessage(Color.error, "无法打开医疗卡.");
  }
}

function row(label: string, value: string): string {
  return `${LABEL}${label}:\t\t${VALUE}${value}`;
}
