import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { saveUserMoney } from "../auth/repository";
import { applyWallet, getAccount, patchAccount } from "../auth/session";
import { houseClassLabel } from "./classes";
import {
  computePaidUntil,
  dailyHouseRent,
  formatRentDate,
  rentAmountForDays,
} from "./rent-math";
import { isRentLastDay } from "./rent";
import { findOwnedHouse, payHouseRent, setHouseRentPaidUntil } from "./repository";

export const BANK_HOUSE_RENT_INFO_DIALOG_ID = 47;
export const BANK_HOUSE_RENT_CONFIRM_DIALOG_ID = 48;
export const BANK_HOUSE_RENT_EMPTY_DIALOG_ID = 49;
export const BANK_HOUSE_RENT_DAYS_DIALOG_ID = 51;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_INPUT = 1;
const MAX_RENT_DAYS = 999;

type PendingRent = {
  houseId: number;
  days: number;
  amount: number;
  paidUntil: string;
};

const pendingRent = new Map<number, PendingRent>();
const payingRent = new Set<number>();

export function clearHouseRentPending(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    pendingRent.delete(id);
  }
}

export function showHouseRentMenu(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  const house = findOwnedHouse(account.id);
  if (!house) {
    try {
      Dialog.show(
        player,
        BANK_HOUSE_RENT_EMPTY_DIALOG_ID,
        DIALOG_STYLE_MSGBOX,
        "房屋付款",
        "您没有房屋.",
        "返回",
        ""
      );
    } catch {
      player.sendClientMessage(Color.error, "你没有房屋.");
    }
    return;
  }

  const daily = dailyHouseRent(house.price);
  const lines = [
    `房屋编号 ${house.id}(${houseClassLabel(house.classId)})`,
    `已付款至:${formatRentDate(house.rentPaidUntil)}`,
    `每日费用:${formatMoney(daily)}`,
  ];

  if (isRentLastDay(house)) {
    lines.push("");
    lines.push("今天是已付款的最后一天.");
    lines.push("若未付款,房屋将于明日 00:00 被收回.");
  }

  try {
    Dialog.show(
      player,
      BANK_HOUSE_RENT_INFO_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "房屋付款",
      lines.join("\n"),
      "下一步",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开房屋付款页面.");
  }
}

function showDaysInputDialog(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  const house = findOwnedHouse(account.id);
  if (!house) {
    player.sendClientMessage(Color.error, "你没有房屋.");
    return;
  }

  const daily = dailyHouseRent(house.price);
  const bank = Math.max(0, Math.floor(account.bank));
  const body = [
    `房屋编号 ${house.id}`,
    `每日费用:${formatMoney(daily)}`,
    `银行账户:${formatMoney(bank)}`,
    "",
    "请输入天数:",
  ].join("\n");

  try {
    Dialog.show(
      player,
      BANK_HOUSE_RENT_DAYS_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "房屋付款",
      body,
      "下一步",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开天数输入页面.");
  }
}

export function handleHouseRentDialog(
  player: Player,
  dialogId: number,
  ok: boolean,
  _listItem: number,
  inputText: string
): boolean {
  if (
    dialogId !== BANK_HOUSE_RENT_INFO_DIALOG_ID &&
    dialogId !== BANK_HOUSE_RENT_DAYS_DIALOG_ID &&
    dialogId !== BANK_HOUSE_RENT_CONFIRM_DIALOG_ID &&
    dialogId !== BANK_HOUSE_RENT_EMPTY_DIALOG_ID
  ) {
    return false;
  }

  if (dialogId === BANK_HOUSE_RENT_EMPTY_DIALOG_ID) {
    return true;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return true;
  }

  if (dialogId === BANK_HOUSE_RENT_INFO_DIALOG_ID) {
    if (!ok) {
      clearHouseRentPending(player);
      return true;
    }

    showDaysInputDialog(player);
    return true;
  }

  if (dialogId === BANK_HOUSE_RENT_DAYS_DIALOG_ID) {
    if (!ok) {
      clearHouseRentPending(player);
      showHouseRentMenu(player);
      return true;
    }

    const house = findOwnedHouse(account.id);
    if (!house) {
      player.sendClientMessage(Color.error, "你没有房屋.");
      return true;
    }

    const days = parseRentDays(inputText);
    if (days === null) {
      player.sendClientMessage(Color.error, "请输入 1 到 999 之间的整数天数.");
      showDaysInputDialog(player);
      return true;
    }

    const amount = rentAmountForDays(house.price, days);
    const bank = Math.max(0, Math.floor(account.bank));
    if (amount > bank) {
      player.sendClientMessage(Color.error, "银行账户余额不足.");
      showDaysInputDialog(player);
      return true;
    }

    const paidUntil = computePaidUntil(house.rentPaidUntil, days);
    pendingRent.set(slotId, {
      houseId: house.id,
      days,
      amount,
      paidUntil,
    });

    try {
      Dialog.show(
        player,
        BANK_HOUSE_RENT_CONFIRM_DIALOG_ID,
        DIALOG_STYLE_MSGBOX,
        "确认",
        [
          `房屋编号 ${house.id}`,
          `付款: ${days} ${dayLabel(days)} - ${formatMoney(amount)}`,
          `新的付款日期:${formatRentDate(paidUntil)}`,
          "",
          "将从银行账户扣款.",
        ].join("\n"),
        "付款",
        "返回"
      );
    } catch {
      clearHouseRentPending(player);
      player.sendClientMessage(Color.error, "无法打开确认对话框.");
    }
    return true;
  }

  if (!ok) {
    clearHouseRentPending(player);
    showDaysInputDialog(player);
    return true;
  }

  void confirmHouseRent(player);
  return true;
}

async function confirmHouseRent(player: Player): Promise<void> {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null || !isPlayerActive(player)) {
    return;
  }

  const pending = pendingRent.get(slotId);
  if (!pending) {
    showHouseRentMenu(player);
    return;
  }

  const house = findOwnedHouse(account.id);
  if (!house || house.id !== pending.houseId) {
    clearHouseRentPending(player);
    player.sendClientMessage(Color.error, "你没有房屋.");
    return;
  }

  if (payingRent.has(account.id)) {
    return;
  }

  payingRent.add(account.id);
  let result;
  try {
    result = await payHouseRent(account.id, house.id, pending.days);
  } catch (error: unknown) {
    payingRent.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`House payment ${house.id} (${account.name}): ${message}`);
    player.sendClientMessage(Color.error, "付款失败.请重试.");
    return;
  }
  payingRent.delete(account.id);
  clearHouseRentPending(player);

  if (!result.ok) {
    if (result.reason === "owner") {
      player.sendClientMessage(Color.error, "你没有房屋.");
      return;
    }
    if (result.reason === "funds") {
      player.sendClientMessage(Color.error, "银行账户余额不足.");
      showDaysInputDialog(player);
      return;
    }
    player.sendClientMessage(Color.error, "付款失败.请重试.");
    return;
  }

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return;
  }

  setHouseRentPaidUntil(house.id, result.paidUntil);

  patchAccount(player, { bank: result.bankLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  void saveUserMoney(account.id, account.money, result.bankLeft).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Failed to save bank balance for ${account.name}: ${message}`);
  });

  player.sendClientMessage(
    Color.tryOk,
    `房屋 №${house.id} 已支付 ${pending.days} ${dayLabel(pending.days)}.已付至: ${formatRentDate(result.paidUntil)}.`
  );
  player.sendClientMessage(
    Color.info,
    `已从银行账户扣除 ${formatMoney(result.amount)}. 余额: ${formatMoney(result.bankLeft)}.`
  );
}

function parseRentDays(input: string): number | null {
  const raw = input.trim();
  if (!/^\d+$/.test(raw) || raw.length > 3) {
    return null;
  }

  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_RENT_DAYS) {
    return null;
  }

  return days;
}

function dayLabel(days: number): string {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "天";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "天";
  }
  return "天";
}
