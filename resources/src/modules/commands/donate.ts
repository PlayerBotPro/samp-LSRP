import { Dialog, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import { isPlayerActive, playerId } from "../../shared/player";
import { isArmyFactoryOnShift } from "../army-factory";
import { genderLabel, type Gender } from "../auth/gender";
import { LICENSE_ROWS, type Licenses } from "../auth/licenses";
import {
  holdDonateWallet,
  isDonateBusy,
  lockDonate,
  releaseDonateWallet,
  unlockDonate,
} from "../auth/donate-guard";
import {
  convertDonateToCash,
  claimUserPhone,
  grantUserLawfulness,
  refundUserDonate,
  saveUserGender,
  saveUserLicenses,
  saveUserMedcard,
  saveUserMilitaryId,
  saveUserSkin,
  saveUserOrg,
  saveUserWantedLevel,
  spendUserDonate,
} from "../auth/repository";
import { isSkinPicking } from "../auth/skin-picker";
import { SKINS, hasSkin, type SkinOption } from "../auth/skins";
import {
  MAX_LAWFULNESS,
  PHONE_DIGITS,
  applyWallet,
  getAccount,
  isAuthenticated,
  normalizeLawfulness,
  patchAccount,
  type Account,
} from "../auth/session";
import { setPlayerWantedLevel } from "../auth/wanted";
import { isLoaderOnShift } from "../loader";
import { isMinerOnShift } from "../miner";
import { applyOrgVisuals, getMembership, MAX_ORG_RANK, ORG_NONE, resolvePlayerSkin } from "../org";
import { syncOrgVehicleAccess } from "../vehicles/access";
import { refreshCaptureView } from "../zones/capture";
import { registerCommand } from "./registry";

export const DONATE_MENU_DIALOG_ID = 160;
export const DONATE_CONVERT_DIALOG_ID = 161;
export const DONATE_SKIN_DIALOG_ID = 162;
export const DONATE_PHONE_DIALOG_ID = 163;

const DIALOG_STYLE_INPUT = 1;
const DIALOG_STYLE_TABLIST_HEADERS = 5;
const PLAYER_STATE_WASTED = 7;
const PLAYER_STATE_SPECTATING = 9;

/** 1 捐赠点。 */
const CASH_PER_DONATE = 2500;
const MAX_MONEY = 2_000_000_000;

const PRICE_GENDER = 30;
const PRICE_LICENSES = 25;
const PRICE_MEDCARD = 10;
const PRICE_MILITARY = 15;
const PRICE_WANTED = 8;
const PRICE_LAW = 5;
const LAW_GAIN = 5;
const PRICE_LEAVE_ORG = 50;
const PRICE_PHONE = 20;

const SKIN_PRICE: Readonly<Record<number, number>> = {
  78: 5,
  79: 5,
  134: 5,
  136: 8,
  137: 5,
  160: 10,
  200: 10,
  212: 5,
  213: 12,
  230: 5,
  239: 5,
  77: 5,
  90: 8,
  93: 8,
  131: 10,
  151: 8,
  157: 10,
  190: 15,
  192: 15,
  198: 10,
  201: 10,
  211: 12,
};

const DEFAULT_SKIN: Record<Gender, number> = {
  male: 136,
  female: 93,
};

type MenuAction =
  | "convert"
  | "skin"
  | "gender"
  | "licenses"
  | "medcard"
  | "military"
  | "wanted"
  | "law"
  | "org"
  | "phone";

const MENU: readonly { action: MenuAction; label: string; price: string }[] = [
  { action: "convert", label: "兑换现金", price: `1 = ${formatMoney(CASH_PER_DONATE)}` },
  { action: "skin", label: "更换皮肤", price: "5 起" },
  { action: "gender", label: "更改性别", price: String(PRICE_GENDER) },
  { action: "licenses", label: "全部执照", price: String(PRICE_LICENSES) },
  { action: "medcard", label: "医疗卡", price: String(PRICE_MEDCARD) },
  { action: "military", label: "军人证", price: String(PRICE_MILITARY) },
  { action: "wanted", label: "降低通缉等级", price: String(PRICE_WANTED) },
  { action: "law", label: "守法值 +5", price: String(PRICE_LAW) },
  { action: "org", label: "退出组织", price: String(PRICE_LEAVE_ORG) },
  { action: "phone", label: "更换电话号码", price: String(PRICE_PHONE) },
];

/** 记录该玩家当前打开列表中的皮肤。 */
const skinOffer = new Map<number, readonly SkinOption[]>();

registerCommand("donate", "捐赠点：兑换与服务", (player) => {
  showDonateMenu(player);
});

export function bindDonateDialogs(): void {
  omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
    const id = Number(dialogId);
    if (
      id !== DONATE_MENU_DIALOG_ID &&
      id !== DONATE_CONVERT_DIALOG_ID &&
      id !== DONATE_SKIN_DIALOG_ID &&
      id !== DONATE_PHONE_DIALOG_ID
    ) {
      return;
    }

    const ok = Number(response) !== 0;
    const input = String(inputText ?? "");
    const item = Number(listItem);

    if (id === DONATE_MENU_DIALOG_ID) {
      void onMenu(player, ok, item);
      return;
    }

    if (id === DONATE_CONVERT_DIALOG_ID) {
      void onConvert(player, ok, input);
      return;
    }

    if (id === DONATE_PHONE_DIALOG_ID) {
      void onPhone(player, ok, input);
      return;
    }

    void onSkin(player, ok, item);
  });

  omp.on("playerDisconnect", (player) => {
    const slotId = playerId(player);
    if (slotId !== null) {
      skinOffer.delete(slotId);
    }
  });
}

function showDonateMenu(player: Player): void {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  if (isDonateBusy(player)) {
    player.sendClientMessage(Color.error, "请稍候，上一次购买尚未完成。");
    return;
  }

  if (isSkinPicking(player)) {
    player.sendClientMessage(Color.error, "请先完成皮肤选择。");
    return;
  }

  const body = ["服务\t价格", ...MENU.map((row) => `${row.label}\t${row.price}`)].join("\n");

  try {
    Dialog.show(
      player,
      DONATE_MENU_DIALOG_ID,
      DIALOG_STYLE_TABLIST_HEADERS,
      `捐赠点： ${account.donate}`,
      body,
      "选择",
      "关闭"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开捐赠商城。");
  }
}

async function onMenu(player: Player, ok: boolean, listItem: number): Promise<void> {
  if (!ok) {
    return;
  }

  const row = MENU[listItem];
  if (!row) {
    return;
  }

  if (row.action === "convert") {
    showConvert(player);
    return;
  }

  if (row.action === "skin") {
    showSkins(player);
    return;
  }

  if (row.action === "phone") {
    showPhone(player);
    return;
  }

  await runLocked(player, async () => {
    if (row.action === "gender") {
      await buyGender(player);
      return;
    }

    if (row.action === "licenses") {
      await buyLicenses(player);
      return;
    }

    if (row.action === "medcard") {
      await buyMedcard(player);
      return;
    }

    if (row.action === "military") {
      await buyMilitary(player);
      return;
    }

    if (row.action === "wanted") {
      await buyWanted(player);
      return;
    }

    if (row.action === "org") {
      await buyLeaveOrg(player);
      return;
    }

    await buyLaw(player);
  });
}

function showConvert(player: Player): void {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  try {
    Dialog.show(
      player,
      DONATE_CONVERT_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "兑换现金",
      `兑换比例：1 捐赠点 = ${formatMoney(CASH_PER_DONATE)}\n余额： ${account.donate}\n\n请输入要兑换的捐赠点数量：`,
      "兑换",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开兑换窗口。");
  }
}

async function onConvert(player: Player, ok: boolean, input: string): Promise<void> {
  if (!ok) {
    showDonateMenu(player);
    return;
  }

  await runLocked(player, async (slotId) => {
    holdDonateWallet(slotId);
    try {
      await exchangeDonate(player, input);
    } finally {
      releaseDonateWallet(slotId);
    }
  });
}

async function exchangeDonate(player: Player, input: string): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  const amount = Number(input.trim());
  if (!Number.isSafeInteger(amount) || amount < 1) {
    player.sendClientMessage(Color.error, "请输入大于零的整数。");
    showConvert(player);
    return;
  }

  if (amount > account.donate) {
    player.sendClientMessage(Color.error, "捐赠点不足。");
    showConvert(player);
    return;
  }

  const cash = amount * CASH_PER_DONATE;
  const money = account.money + cash;
  if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(money) || money > MAX_MONEY) {
    player.sendClientMessage(Color.error, "现金已达上限，无法兑换。");
    return;
  }

  const userId = account.id;
  let spent = false;
  try {
    spent = await convertDonateToCash(userId, amount, cash, MAX_MONEY);
  } catch {
    if (isPlayerActive(player)) {
      player.sendClientMessage(Color.error, "捐赠点兑换失败。");
    }
    return;
  }

  if (!spent) {
    if (isPlayerActive(player)) {
      player.sendClientMessage(Color.error, "捐赠点不足或现金超出上限。");
    }
    return;
  }

  const live = getAccount(player);
  if (!live || live.id !== userId || !isPlayerActive(player)) {
    return;
  }

  const donate = Math.max(0, live.donate - amount);
  const nextMoney = live.money + cash;
  patchAccount(player, { money: nextMoney, donate });
  applyWallet(player, { ...live, money: nextMoney, donate });
  player.sendClientMessage(
    Color.info,
    `你用 ${amount} 捐赠点兑换了 ${formatMoney(cash)}，剩余 ${donate} 捐赠点。`
  );
}

function showPhone(player: Player): void {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  const current = account.phone ?? "无";

  try {
    Dialog.show(
      player,
      DONATE_PHONE_DIALOG_ID,
      DIALOG_STYLE_INPUT,
      "电话号码",
      `必须为 ${PHONE_DIGITS} 位数字，例如 000000。\n当前号码：${current}\n价格：${PRICE_PHONE}\n\n新号码：`,
      "更改",
      "返回"
    );
  } catch {
    player.sendClientMessage(Color.error, "无法打开更换号码窗口。");
  }
}

async function onPhone(player: Player, ok: boolean, input: string): Promise<void> {
  if (!ok) {
    showDonateMenu(player);
    return;
  }

  await runLocked(player, async () => {
    await buyPhone(player, input);
  });
}

async function buyPhone(player: Player, input: string): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  const phone = parsePhone(input);
  if (!phone) {
    player.sendClientMessage(Color.error, `号码必须为 ${PHONE_DIGITS} 位数字，不能包含空格。`);
    showPhone(player);
    return;
  }

  if (account.phone === phone) {
    player.sendClientMessage(Color.error, "这已经是你的号码。");
    showPhone(player);
    return;
  }

  const userId = account.id;
  if (!(await charge(player, userId, PRICE_PHONE))) {
    return;
  }

  let result: "ok" | "taken" | "missing";
  try {
    result = await claimUserPhone(userId, phone);
  } catch {
    await refund(player, userId, PRICE_PHONE);
    return;
  }

  if (result === "taken") {
    await refund(player, userId, PRICE_PHONE, "该号码已被使用，捐赠点已退还。");
    return;
  }

  if (result !== "ok") {
    await refund(player, userId, PRICE_PHONE);
    return;
  }

  remember(player, userId, { phone });
  if (samePlayer(player, userId)) {
    player.sendClientMessage(Color.info, `电话号码已更改为 ${phone}，扣除 ${PRICE_PHONE} 捐赠点。`);
  }
}

async function buyLeaveOrg(player: Player): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  const membership = getMembership(account);
  if (!membership && account.orgId === ORG_NONE) {
    player.sendClientMessage(Color.error, "你尚未加入任何组织。");
    return;
  }

  if (membership && membership.rank.id === MAX_ORG_RANK) {
    player.sendClientMessage(Color.error, "组织首领无法通过捐赠商城退出组织。");
    return;
  }

  const orgName = membership?.org.name ?? "组织";
  const userId = account.id;
  if (!(await charge(player, userId, PRICE_LEAVE_ORG))) {
    return;
  }

  const after = getAccount(player);
  if (after && after.id === userId) {
    const now = getMembership(after);
    if (now && now.rank.id === MAX_ORG_RANK) {
      await refund(player, userId, PRICE_LEAVE_ORG, "你已成为组织首领，捐赠点已退还。");
      return;
    }
    if (!now && after.orgId === ORG_NONE) {
      await refund(player, userId, PRICE_LEAVE_ORG, "你已不在该组织中，捐赠点已退还。");
      return;
    }
  }

  try {
    await saveUserOrg(userId, ORG_NONE, 0);
  } catch {
    await refund(player, userId, PRICE_LEAVE_ORG);
    return;
  }

  if (!samePlayer(player, userId)) {
    return;
  }

  patchAccount(player, { orgId: ORG_NONE, orgRank: 0 });
  if (canShowSkin(player)) {
    applyOrgVisuals(player);
  }
  syncOrgVehicleAccess(player);
  refreshCaptureView(player);
  player.sendClientMessage(
    Color.info,
    `你已退出组织 ${orgName}，扣除 ${PRICE_LEAVE_ORG} 捐赠点。`
  );
}

function parsePhone(input: string): string | null {
  const raw = input.trim();
  if (!new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(raw)) {
    return null;
  }
  return raw;
}

function showSkins(player: Player): void {
  const account = liveAccount(player);
  const slotId = playerId(player);
  if (!account || slotId === null) {
    return;
  }

  const options = SKINS[account.gender];
  skinOffer.set(slotId, options);

  const body = [
    "皮肤\tID\t价格",
    ...options.map((skin) => `${skin.label}\t${skin.id}\t${skinPrice(skin.id)}`),
  ].join("\n");

  try {
    Dialog.show(
      player,
      DONATE_SKIN_DIALOG_ID,
      DIALOG_STYLE_TABLIST_HEADERS,
      `皮肤： ${genderLabel(account.gender)}`,
      body,
      "购买",
      "返回"
    );
  } catch {
    skinOffer.delete(slotId);
    player.sendClientMessage(Color.error, "无法打开皮肤列表。");
  }
}

async function onSkin(player: Player, ok: boolean, listItem: number): Promise<void> {
  const slotId = playerId(player);
  const options = slotId === null ? undefined : skinOffer.get(slotId);
  if (slotId !== null) {
    skinOffer.delete(slotId);
  }

  if (!ok) {
    showDonateMenu(player);
    return;
  }

  const skin = options?.[listItem];
  if (!skin) {
    return;
  }

  await runLocked(player, async () => {
    await buySkin(player, skin);
  });
}

async function buySkin(player: Player, skin: SkinOption): Promise<void> {
  const account = liveAccount(player);
  if (!account || !hasSkin(account.gender, skin.id)) {
    if (isPlayerActive(player)) {
      player.sendClientMessage(Color.error, "此皮肤不可用。");
    }
    return;
  }

  if (account.skin === skin.id) {
    player.sendClientMessage(Color.error, "你已购买此皮肤。");
    showSkins(player);
    return;
  }

  const price = skinPrice(skin.id);
  const userId = account.id;
  if (!(await charge(player, userId, price))) {
    return;
  }

  const charged = getAccount(player);
  if (charged && charged.id === userId && charged.skin === skin.id) {
    await refund(player, userId, price, "你已购买此皮肤，捐赠点已退还。");
    return;
  }

  try {
    await saveUserSkin(userId, skin.id);
  } catch {
    await refund(player, userId, price);
    return;
  }

  const live = getAccount(player);
  if (!live || live.id !== userId || !isPlayerActive(player)) {
    return;
  }

  patchAccount(player, { skin: skin.id });
  const visible = canShowSkin(player);
  if (visible) {
    applyOrgVisuals(player);
  }

  const updated = getAccount(player);
  const worn = visible && updated !== null && resolvePlayerSkin(updated) === skin.id;
  player.sendClientMessage(
    Color.info,
    worn
      ? `你已更换为皮肤 ${skin.label}，扣除 ${price} 捐赠点。`
      : `皮肤 ${skin.label} 已保存。你当前穿着其他制服，扣除 ${price} 捐赠点。`
  );
}

async function buyGender(player: Player): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  const next: Gender = account.gender === "female" ? "male" : "female";
  const skin = hasSkin(next, account.skin) ? account.skin : defaultSkin(next);
  const userId = account.id;
  if (!(await charge(player, userId, PRICE_GENDER))) {
    return;
  }

  try {
    await saveUserGender(userId, next, skin);
  } catch {
    await refund(player, userId, PRICE_GENDER);
    return;
  }

  const live = getAccount(player);
  if (!live || live.id !== userId || !isPlayerActive(player)) {
    return;
  }

  patchAccount(player, { gender: next, skin });
  if (canShowSkin(player)) {
    applyOrgVisuals(player);
  }

  const label = SKINS[next].find((option) => option.id === skin)?.label ?? String(skin);
  player.sendClientMessage(
    Color.info,
    `性别已更改为${genderLabel(next).toLowerCase()}，皮肤：${label}，扣除 ${PRICE_GENDER} 捐赠点。`
  );
}

async function buyLicenses(player: Player): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  if (LICENSE_ROWS.every((row) => account.licenses[row.key])) {
    player.sendClientMessage(Color.error, "你已拥有全部执照。");
    return;
  }

  const userId = account.id;
  if (!(await charge(player, userId, PRICE_LICENSES))) {
    return;
  }

  const after = getAccount(player);
  if (after && after.id === userId && LICENSE_ROWS.every((row) => after.licenses[row.key])) {
    await refund(player, userId, PRICE_LICENSES, "你已拥有全部执照，捐赠点已退还。");
    return;
  }

  const licenses: Licenses = {
    car: true,
    moto: true,
    fly: true,
    boat: true,
    gun: true,
  };

  try {
    await saveUserLicenses(userId, licenses);
  } catch {
    await refund(player, userId, PRICE_LICENSES);
    return;
  }

  remember(player, userId, { licenses });
  if (isPlayerActive(player)) {
    player.sendClientMessage(Color.info, `已发放全部执照，扣除 ${PRICE_LICENSES} 捐赠点。`);
  }
}

async function buyMedcard(player: Player): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  if (account.medcard) {
    player.sendClientMessage(Color.error, "你已拥有医疗卡。");
    return;
  }

  const userId = account.id;
  if (!(await charge(player, userId, PRICE_MEDCARD))) {
    return;
  }

  const after = getAccount(player);
  if (after && after.id === userId && after.medcard) {
    await refund(player, userId, PRICE_MEDCARD, "你已拥有医疗卡，捐赠点已退还。");
    return;
  }

  try {
    await saveUserMedcard(userId, true);
  } catch {
    await refund(player, userId, PRICE_MEDCARD);
    return;
  }

  remember(player, userId, { medcard: true });
  if (isPlayerActive(player)) {
    player.sendClientMessage(Color.info, `已购买医疗卡，扣除 ${PRICE_MEDCARD} 捐赠点。`);
  }
}

async function buyMilitary(player: Player): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  if (account.militaryId) {
    player.sendClientMessage(Color.error, "你已拥有军人证。");
    return;
  }

  const userId = account.id;
  if (!(await charge(player, userId, PRICE_MILITARY))) {
    return;
  }

  const after = getAccount(player);
  if (after && after.id === userId && after.militaryId) {
    await refund(player, userId, PRICE_MILITARY, "你已拥有军人证，捐赠点已退还。");
    return;
  }

  try {
    await saveUserMilitaryId(userId, true);
  } catch {
    await refund(player, userId, PRICE_MILITARY);
    return;
  }

  remember(player, userId, { militaryId: true });
  if (isPlayerActive(player)) {
    player.sendClientMessage(Color.info, `已购买军人证，扣除 ${PRICE_MILITARY} 捐赠点。`);
  }
}

async function buyWanted(player: Player): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  if (account.wantedLevel <= 0) {
    player.sendClientMessage(Color.error, "你没有被通缉。");
    return;
  }

  const userId = account.id;
  const fallback = account.wantedLevel - 1;
  if (!(await charge(player, userId, PRICE_WANTED))) {
    return;
  }

  const live = getAccount(player);
  if (!live || live.id !== userId || !isPlayerActive(player)) {
    try {
      await saveUserWantedLevel(userId, fallback);
    } catch {
      await refund(player, userId, PRICE_WANTED);
    }
    return;
  }

  if (live.wantedLevel <= 0) {
    await refund(player, userId, PRICE_WANTED, "你已不再被通缉，捐赠点已退还。");
    return;
  }

  const next = live.wantedLevel - 1;
  try {
    await saveUserWantedLevel(userId, next);
  } catch {
    await refund(player, userId, PRICE_WANTED);
    return;
  }

  const still = getAccount(player);
  if (!still || still.id !== userId || !isPlayerActive(player)) {
    return;
  }

  setPlayerWantedLevel(player, next);
  player.sendClientMessage(Color.info, `通缉等级已降至 ${next}，扣除 ${PRICE_WANTED} 捐赠点。`);
}

async function buyLaw(player: Player): Promise<void> {
  const account = liveAccount(player);
  if (!account) {
    return;
  }

  if (account.lawfulness >= MAX_LAWFULNESS) {
    player.sendClientMessage(Color.error, "守法值已达上限。");
    return;
  }

  const userId = account.id;
  if (!(await charge(player, userId, PRICE_LAW))) {
    return;
  }

  let granted = false;
  try {
    granted = await grantUserLawfulness(userId, LAW_GAIN);
  } catch {
    await refund(player, userId, PRICE_LAW);
    return;
  }

  if (!granted) {
    await refund(player, userId, PRICE_LAW, "守法值已达上限，捐赠点已退还。");
    return;
  }

  const live = getAccount(player);
  const base = live && live.id === userId ? live.lawfulness : account.lawfulness;
  const next = normalizeLawfulness(base + LAW_GAIN);
  remember(player, userId, { lawfulness: next });
  if (samePlayer(player, userId)) {
    player.sendClientMessage(Color.info, `守法值：${next}，扣除 ${PRICE_LAW} 捐赠点。`);
  }
}

function skinPrice(skinId: number): number {
  return SKIN_PRICE[skinId] ?? 10;
}

function defaultSkin(gender: Gender): number {
  const preferred = DEFAULT_SKIN[gender];
  if (hasSkin(gender, preferred)) {
    return preferred;
  }
  return SKINS[gender][0]?.id ?? preferred;
}

function liveAccount(player: Player): Account | null {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return null;
  }
  return getAccount(player);
}

function canShowSkin(player: Player): boolean {
  if (isMinerOnShift(player) || isLoaderOnShift(player) || isArmyFactoryOnShift(player)) {
    return false;
  }

  try {
    if (!player.isSpawned()) {
      return false;
    }

    const state = player.getState();
    return state !== PLAYER_STATE_WASTED && state !== PLAYER_STATE_SPECTATING;
  } catch {
    return false;
  }
}

function samePlayer(player: Player, userId: number): boolean {
  return isPlayerActive(player) && getAccount(player)?.id === userId;
}

async function runLocked(player: Player, task: (slotId: number) => Promise<void>): Promise<void> {
  const slotId = lockDonate(player);
  if (slotId === null) {
    if (isPlayerActive(player) && isDonateBusy(player)) {
      player.sendClientMessage(Color.error, "请稍候，上一次购买尚未完成。");
    }
    return;
  }

  try {
    await task(slotId);
  } finally {
    unlockDonate(slotId);
  }
}

async function charge(player: Player, userId: number, price: number): Promise<boolean> {
  const before = getAccount(player);
  if (!before || before.id !== userId || !isPlayerActive(player)) {
    return false;
  }

  if (before.donate < price) {
    player.sendClientMessage(Color.error, "捐赠点不足。");
    return false;
  }

  let spent = false;
  try {
    spent = await spendUserDonate(userId, price);
  } catch {
    if (isPlayerActive(player)) {
      player.sendClientMessage(Color.error, "无法扣除捐赠点。");
    }
    return false;
  }

  if (!spent) {
    if (isPlayerActive(player)) {
      player.sendClientMessage(Color.error, "捐赠点不足。");
    }
    return false;
  }

  const live = getAccount(player);
  if (live && live.id === userId) {
    patchAccount(player, { donate: Math.max(0, live.donate - price) });
  }
  return true;
}

async function refund(
  player: Player,
  userId: number,
  price: number,
  message = "无法提供服务，捐赠点已退还。"
): Promise<void> {
  try {
    await refundUserDonate(userId, price);
  } catch {
    if (isPlayerActive(player)) {
      player.sendClientMessage(Color.error, "付款成功，但无法保存服务结果。");
    }
    return;
  }

  const live = getAccount(player);
  if (live && live.id === userId) {
    patchAccount(player, { donate: live.donate + price });
  }

  if (isPlayerActive(player)) {
    player.sendClientMessage(Color.error, message);
  }
}

function remember(player: Player, userId: number, patch: Parameters<typeof patchAccount>[1]): void {
  const live = getAccount(player);
  if (!live || live.id !== userId || !isPlayerActive(player)) {
    return;
  }
  patchAccount(player, patch);
}
