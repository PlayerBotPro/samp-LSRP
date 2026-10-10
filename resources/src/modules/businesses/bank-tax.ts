import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { SERVER_TAG } from "../../shared/brand";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { applyWallet, getAccount, patchAccount } from "../auth/session";
import {
  computePaidUntil,
  dailyBusinessTax,
  formatRentDate,
  taxAmountForDays,
} from "./tax-math";
import { isTaxLastDay } from "./tax";
import {
  findOwnedBusiness,
  payBusinessTax,
  setBusinessBalance,
  setBusinessTaxPaidUntil,
  withdrawBusinessBalance,
} from "./repository";

export const BANK_BIZ_TAX_INFO_DIALOG_ID = 71;
export const BANK_BIZ_TAX_CONFIRM_DIALOG_ID = 72;
export const BANK_BIZ_EMPTY_DIALOG_ID = 73;
export const BANK_BIZ_TAX_DAYS_DIALOG_ID = 74;
export const BANK_BIZ_MENU_DIALOG_ID = 80;
export const BANK_BIZ_WITHDRAW_INPUT_DIALOG_ID = 81;
export const BANK_BIZ_WITHDRAW_CONFIRM_DIALOG_ID = 82;

/** @deprecated use BANK_BIZ_EMPTY_DIALOG_ID */
export const BANK_BIZ_TAX_EMPTY_DIALOG_ID = BANK_BIZ_EMPTY_DIALOG_ID;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_INPUT = 1;
const DIALOG_STYLE_LIST = 2;
const MAX_TAX_DAYS = 999;
const MAX_MONEY = 2_147_483_647;

const BIZ_MENU_ITEMS = ["缴纳企业税款", "提取企业资金"] as const;

type PendingTax = {
  businessId: number;
  days: number;
  amount: number;
  paidUntil: string;
};

type PendingWithdraw = {
  businessId: number;
  amount: number;
};

const pendingTax = new Map<number, PendingTax>();
const pendingWithdraw = new Map<number, PendingWithdraw>();
const payingTax = new Set<number>();
const withdrawing = new Set<number>();

export function clearBusinessTaxPending(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    pendingTax.delete(id);
    pendingWithdraw.delete(id);
  }
}

/** 银行入口:"企业"选项. */
export function showBusinessBankMenu(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  const business = findOwnedBusiness(account.id);
  if (!business) {
    try {
      Dialog.show(
        player,
        BANK_BIZ_EMPTY_DIALOG_ID,
        DIALOG_STYLE_MSGBOX,
        "企业",
        "你没有企业.",
        "返回",
        ""
      );
    } catch {
      player.sendClientMessage(Color.error, "你没有企业.");
    }
    return;
  }

  try {
    Dialog.show(
      player,
      BANK_BIZ_MENU_DIALOG_ID,
      DIALOG_STYLE_LIST,
      "企业",
      BIZ_MENU_ITEMS.join("\n"),
      "选择",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开企业菜单.");
  }
}

export function showBusinessTaxMenu(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  const business = findOwnedBusiness(account.id);
  if (!business) {
    showBusinessBankMenu(player);
    return;
  }

  const daily = dailyBusinessTax(business.price);
  const lines = [
    `${business.name} (#${business.id})`,
    `已缴费至:${formatRentDate(business.taxPaidUntil)}`,
    `每日税款:${formatMoney(daily)}`,
  ];

  if (isTaxLastDay(business)) {
    lines.push("");
    lines.push("今天是最后一个已缴费日.");
    lines.push("若未缴费,企业将于明日 00:00 被收回.");
  }

  try {
    Dialog.show(
      player,
      BANK_BIZ_TAX_INFO_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "缴纳企业税款",
      lines.join("\n"),
      "下一步",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开企业付款页面.");
  }
}

function showDaysInputDialog(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  const business = findOwnedBusiness(account.id);
  if (!business) {
    player.sendClientMessage(Color.error, "你没有企业.");
    return;
  }

  const daily = dailyBusinessTax(business.price);
  const bank = Math.max(0, Math.floor(account.bank));
  const body = [
    `${business.name} (#${business.id})`,
    `每日税款:${formatMoney(daily)}`,
    `银行账户:${formatMoney(bank)}`,
    "",
    "请输入缴费天数:",
  ].join("\n");

  try {
    Dialog.show(
      player,
      BANK_BIZ_TAX_DAYS_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "缴纳企业税款",
      body,
      "下一步",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开天数输入页面.");
  }
}

function showWithdrawInputDialog(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  const business = findOwnedBusiness(account.id);
  if (!business) {
    player.sendClientMessage(Color.error, "你没有企业.");
    return;
  }

  const body = [
    `${business.name} (#${business.id})`,
    `账户余额:${formatMoney(business.balance)}`,
    "",
    "请输入提取金额:",
  ].join("\n");

  try {
    Dialog.show(
      player,
      BANK_BIZ_WITHDRAW_INPUT_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "提取企业资金",
      body,
      "下一步",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开提款页面.");
  }
}

export function handleBusinessTaxDialog(
  player: Player,
  dialogId: number,
  ok: boolean,
  listItem: number,
  inputText: string
): boolean {
  if (
    dialogId !== BANK_BIZ_TAX_INFO_DIALOG_ID &&
    dialogId !== BANK_BIZ_TAX_DAYS_DIALOG_ID &&
    dialogId !== BANK_BIZ_TAX_CONFIRM_DIALOG_ID &&
    dialogId !== BANK_BIZ_EMPTY_DIALOG_ID &&
    dialogId !== BANK_BIZ_MENU_DIALOG_ID &&
    dialogId !== BANK_BIZ_WITHDRAW_INPUT_DIALOG_ID &&
    dialogId !== BANK_BIZ_WITHDRAW_CONFIRM_DIALOG_ID
  ) {
    return false;
  }

  if (dialogId === BANK_BIZ_EMPTY_DIALOG_ID) {
    return true;
  }

  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return true;
  }

  if (dialogId === BANK_BIZ_MENU_DIALOG_ID) {
    if (!ok) {
      clearBusinessTaxPending(player);
      return true;
    }

    if (listItem === 0 || BIZ_MENU_ITEMS[0]?.toLowerCase() === inputText.trim().toLowerCase()) {
      showBusinessTaxMenu(player);
      return true;
    }

    if (listItem === 1 || BIZ_MENU_ITEMS[1]?.toLowerCase() === inputText.trim().toLowerCase()) {
      showWithdrawInputDialog(player);
      return true;
    }

    showBusinessBankMenu(player);
    return true;
  }

  if (dialogId === BANK_BIZ_TAX_INFO_DIALOG_ID) {
    if (!ok) {
      clearBusinessTaxPending(player);
      showBusinessBankMenu(player);
      return true;
    }

    showDaysInputDialog(player);
    return true;
  }

  if (dialogId === BANK_BIZ_TAX_DAYS_DIALOG_ID) {
    if (!ok) {
      clearBusinessTaxPending(player);
      showBusinessTaxMenu(player);
      return true;
    }

    const business = findOwnedBusiness(account.id);
    if (!business) {
      player.sendClientMessage(Color.error, "你没有企业.");
      return true;
    }

    const days = parseTaxDays(inputText);
    if (days === null) {
      player.sendClientMessage(Color.error, "请输入 1 到 999 之间的整数天数.");
      showDaysInputDialog(player);
      return true;
    }

    const amount = taxAmountForDays(business.price, days);
    const bank = Math.max(0, Math.floor(account.bank));
    if (amount > bank) {
      player.sendClientMessage(Color.error, "银行账户余额不足.");
      showDaysInputDialog(player);
      return true;
    }

    const paidUntil = computePaidUntil(business.taxPaidUntil, days);
    pendingTax.set(slotId, {
      businessId: business.id,
      days,
      amount,
      paidUntil,
    });

    try {
      Dialog.show(
        player,
        BANK_BIZ_TAX_CONFIRM_DIALOG_ID,
        DIALOG_STYLE_MSGBOX,
        "确认",
        [
          `${business.name} (#${business.id})`,
          `缴费:${days}天 - ${formatMoney(amount)}`,
          `新的缴费日期:${formatRentDate(paidUntil)}`,
          "",
          "费用将从银行账户扣除.",
        ].join("\n"),
        "缴费",
        "返回"
      );
    } catch {
      clearBusinessTaxPending(player);
      player.sendClientMessage(Color.error, "无法打开确认对话框.");
    }
    return true;
  }

  if (dialogId === BANK_BIZ_TAX_CONFIRM_DIALOG_ID) {
    if (!ok) {
      clearBusinessTaxPending(player);
      showDaysInputDialog(player);
      return true;
    }

    void confirmBusinessTax(player);
    return true;
  }

  if (dialogId === BANK_BIZ_WITHDRAW_INPUT_DIALOG_ID) {
    if (!ok) {
      pendingWithdraw.delete(slotId);
      showBusinessBankMenu(player);
      return true;
    }

    const business = findOwnedBusiness(account.id);
    if (!business) {
      player.sendClientMessage(Color.error, "你没有企业.");
      return true;
    }

    const amount = parseAmount(inputText);
    if (amount === null) {
      player.sendClientMessage(Color.error, "请输入大于 0 的整数金额.");
      showWithdrawInputDialog(player);
      return true;
    }

    if (amount > business.balance) {
      player.sendClientMessage(Color.error, "企业账户资金不足.");
      showWithdrawInputDialog(player);
      return true;
    }

    const cash = Math.max(0, Math.floor(account.money));
    if (cash > MAX_MONEY - amount) {
      player.sendClientMessage(Color.error, "不能携带这么多现金.");
      showWithdrawInputDialog(player);
      return true;
    }

    pendingWithdraw.set(slotId, { businessId: business.id, amount });

    try {
      Dialog.show(
        player,
        BANK_BIZ_WITHDRAW_CONFIRM_DIALOG_ID,
        DIALOG_STYLE_MSGBOX,
        "确认",
        [
          `${business.name} (#${business.id})`,
          `提取:${formatMoney(amount)}`,
          `提取后余额:${formatMoney(business.balance - amount)}`,
          "",
          "资金将以现金形式发放.",
        ].join("\n"),
        "提取",
        "返回"
      );
    } catch {
      pendingWithdraw.delete(slotId);
      player.sendClientMessage(Color.error, "无法打开确认对话框.");
    }
    return true;
  }

  if (dialogId === BANK_BIZ_WITHDRAW_CONFIRM_DIALOG_ID) {
    if (!ok) {
      pendingWithdraw.delete(slotId);
      showWithdrawInputDialog(player);
      return true;
    }

    void confirmBusinessWithdraw(player);
    return true;
  }

  return true;
}

async function confirmBusinessTax(player: Player): Promise<void> {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null || !isPlayerActive(player)) {
    return;
  }

  const pending = pendingTax.get(slotId);
  if (!pending) {
    showBusinessTaxMenu(player);
    return;
  }

  const business = findOwnedBusiness(account.id);
  if (!business || business.id !== pending.businessId) {
    clearBusinessTaxPending(player);
    player.sendClientMessage(Color.error, "你没有企业.");
    return;
  }

  if (payingTax.has(account.id)) {
    return;
  }

  payingTax.add(account.id);
  let result;
  try {
    result = await payBusinessTax(account.id, business.id, pending.days);
  } catch (error: unknown) {
    payingTax.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Pay business tax ${business.id} (${account.name}): ${message}`);
    player.sendClientMessage(Color.error, "付款失败.请重试.");
    return;
  }
  payingTax.delete(account.id);
  clearBusinessTaxPending(player);

  if (!result.ok) {
    if (result.reason === "owner") {
      player.sendClientMessage(Color.error, "你没有企业.");
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

  // 数据库已在事务中更新,因此同步缓存.
  setBusinessTaxPaidUntil(business.id, result.paidUntil);

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return;
  }

  patchAccount(player, { bank: result.bankLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  player.sendClientMessage(
    Color.tryOk,
    `企业 #${business.id} 已支付 ${pending.days} ${dayLabel(pending.days)}.已付至: ${formatRentDate(result.paidUntil)}.`
  );
  player.sendClientMessage(
    Color.info,
    `已从银行账户扣除 ${formatMoney(result.amount)}. 余额: ${formatMoney(result.bankLeft)}.`
  );
}

async function confirmBusinessWithdraw(player: Player): Promise<void> {
  const account = getAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null || !isPlayerActive(player)) {
    return;
  }

  const pending = pendingWithdraw.get(slotId);
  if (!pending) {
    showBusinessBankMenu(player);
    return;
  }

  const business = findOwnedBusiness(account.id);
  if (!business || business.id !== pending.businessId) {
    pendingWithdraw.delete(slotId);
    player.sendClientMessage(Color.error, "你没有企业.");
    return;
  }

  if (withdrawing.has(account.id)) {
    return;
  }

  withdrawing.add(account.id);
  let result;
  try {
    result = await withdrawBusinessBalance(account.id, business.id, pending.amount);
  } catch (error: unknown) {
    withdrawing.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`Withdraw business funds ${business.id} (${account.name}): ${message}`);
    player.sendClientMessage(Color.error, "提款失败.请重试.");
    return;
  }
  withdrawing.delete(account.id);
  pendingWithdraw.delete(slotId);

  if (!result.ok) {
    if (result.reason === "owner") {
      player.sendClientMessage(Color.error, "你没有企业.");
      return;
    }
    if (result.reason === "funds") {
      player.sendClientMessage(Color.error, "企业账户资金不足.");
      showWithdrawInputDialog(player);
      return;
    }
    player.sendClientMessage(Color.error, "提款失败.请重试.");
    return;
  }

  // 数据库已在事务中更新,因此同步缓存.
  setBusinessBalance(business.id, result.balanceLeft);

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return;
  }

  patchAccount(player, { money: result.cashLeft });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  player.sendClientMessage(
    Color.tryOk,
    `你已从企业 #${business.id} 提取 ${formatMoney(result.amount)}. 现金: ${formatMoney(result.cashLeft)}.`
  );
  player.sendClientMessage(
    Color.info,
    `企业账户余额剩余 ${formatMoney(result.balanceLeft)}.`
  );
}

function parseTaxDays(input: string): number | null {
  const raw = input.trim();
  if (!/^\d+$/.test(raw) || raw.length > 3) {
    return null;
  }

  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_TAX_DAYS) {
    return null;
  }

  return days;
}

function parseAmount(input: string): number | null {
  const raw = input.trim().replace(/^\$/, "");
  if (!/^\d+$/.test(raw) || raw.length > 10) {
    return null;
  }

  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_MONEY) {
    return null;
  }

  return amount;
}

function dayLabel(_days: number): string {
  return "天";
}
