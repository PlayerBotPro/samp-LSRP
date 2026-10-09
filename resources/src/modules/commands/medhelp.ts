import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { formatMoney } from "../../shared/money";
import {
  WHISPER_RADIUS,
  arePlayersNearby,
  clipClientMessage,
} from "../../shared/nearby";
import { isPlayerActive, playerChatName, playerId, playerName } from "../../shared/player";
import {
  claimYnOffer,
  getYnOfferKind,
  releaseYnOffer,
} from "../../shared/yn-offer";
import { byGender } from "../auth/gender";
import {
  applyHealth,
  applyWallet,
  getAccount,
  isAuthenticated,
  MAX_HEALTH,
  patchAccount,
} from "../auth/session";
import { dischargeHospitalPatient } from "../hospital";
import { ORG_HOSPITAL_ID, getMembership } from "../org";
import {
  consumeHospitalMed,
  getCarriedHospitalMeds,
} from "../org/hospital-medkit";
import { queueSave } from "../persist";
import { isJailed } from "../prison/sentence";
import { HOSPITAL_WORLD } from "../spawn/point";
import { isRegisteredOrgVehicle } from "../vehicles/access";
import { registerCommand } from "./registry";

const PLAYER_STATE_DRIVER = 2;
const PLAYER_STATE_PASSENGER = 3;
const KEY_YES = 65536;
const KEY_NO = 131072;
const OFFER_TTL_MS = 60_000;
const MIN_HEAL_PRICE = 1;
const MAX_HEAL_PRICE = 5000;

type MedhelpOffer = {
  doctorId: number;
  doctorUserId: number;
  price: number;
  expiresAt: number;
};

/** 治疗提议：患者槽位 → 提议。 */
const pendingOffers = new Map<number, MedhelpOffer>();

registerCommand(
  "medhelp",
  "医院：向附近玩家提供治疗（需要仓库中的药品）",
  (player, args) => {
    tryMedhelp(player, args.trim());
  }
);

export function bindMedhelpOffers(): void {
  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const slot = playerId(player);
    if (slot === null || getYnOfferKind(slot) !== "medhelp") {
      return;
    }

    const offer = pendingOffers.get(slot);
    if (!offer) {
      releaseYnOffer(slot, "medhelp");
      return;
    }

    if (Date.now() > offer.expiresAt) {
      clearExpiredMedhelpOffer(slot);
      player.sendClientMessage(Color.error, "治疗报价已过期。");
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
      releaseYnOffer(slot, "medhelp");
    }

    for (const [targetSlot, offer] of pendingOffers) {
      if (offer.doctorId === slot) {
        pendingOffers.delete(targetSlot);
        releaseYnOffer(targetSlot, "medhelp");
        const target = omp.players.at(targetSlot);
        if (target && isPlayerActive(target)) {
          target.sendClientMessage(Color.error, "医生已退出游戏。治疗已取消。");
        }
      }
    }
  });
}

function tryMedhelp(player: Player, raw: string): void {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return;
  }

  const account = getAccount(player);
  if (!account) {
    return;
  }

  const membership = getMembership(account);
  if (!membership || membership.org.id !== ORG_HOSPITAL_ID) {
    player.sendClientMessage(Color.error, "此命令仅供医院员工使用。");
    return;
  }

  if (isJailed(player) || account.hospitalized) {
    player.sendClientMessage(Color.error, "现在不能进行治疗。");
    return;
  }

  if (getCarriedHospitalMeds(player) < 1) {
    player.sendClientMessage(
      Color.error,
      "没有药品。请到医院员工区的仓库领取药品包。"
    );
    return;
  }

  if (!canHealHere(player)) {
    player.sendClientMessage(
      Color.error,
      "只能在医院或医院车辆内治疗。"
    );
    return;
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    player.sendClientMessage(
      Color.error,
      `用法: /medhelp [id] [金额 ${MIN_HEAL_PRICE}-${MAX_HEAL_PRICE}]`
    );
    return;
  }

  const targetId = Number(parts[0]);
  const price = Math.floor(Number(parts[1]));
  if (!Number.isInteger(targetId) || targetId < 0) {
    player.sendClientMessage(Color.error, "玩家 ID 无效。");
    return;
  }

  if (
    !Number.isFinite(price) ||
    !Number.isSafeInteger(price) ||
    price < MIN_HEAL_PRICE ||
    price > MAX_HEAL_PRICE
  ) {
    player.sendClientMessage(
      Color.error,
      `金额必须在 ${formatMoney(MIN_HEAL_PRICE)} 到 ${formatMoney(MAX_HEAL_PRICE)} 之间。`
    );
    return;
  }

  const target = omp.players.at(targetId);
  if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
    player.sendClientMessage(Color.error, "玩家不在线。");
    return;
  }

  const doctorSlot = playerId(player);
  const targetSlot = playerId(target);
  if (doctorSlot === null || targetSlot === null || doctorSlot === targetSlot) {
    player.sendClientMessage(Color.error, "不能用此命令治疗自己。");
    return;
  }

  const targetAccount = getAccount(target);
  if (!targetAccount) {
    return;
  }

  if (isJailed(target)) {
    player.sendClientMessage(Color.error, "玩家在监狱里。");
    return;
  }

  if (!arePlayersNearby(player, target, WHISPER_RADIUS)) {
    player.sendClientMessage(Color.error, "请靠近患者。");
    return;
  }

  if (!canHealHere(target)) {
    player.sendClientMessage(
      Color.error,
      "患者必须在医院或医院车辆内。"
    );
    return;
  }

  let doctorInHospitalWorld = false;
  try {
    doctorInHospitalWorld = player.getVirtualWorld() === HOSPITAL_WORLD;
  } catch {
    return;
  }

  if (!doctorInHospitalWorld && !sameHospitalVehicle(player, target)) {
    player.sendClientMessage(
      Color.error,
      "患者必须和你在同一辆医院车辆内。"
    );
    return;
  }

  let targetHp = targetAccount.health;
  try {
    targetHp = target.getHealth();
  } catch {
    // fallback
  }

  if (targetHp >= MAX_HEALTH - 0.5) {
    player.sendClientMessage(Color.error, "玩家已经健康。");
    return;
  }

  if (targetAccount.money < price) {
    player.sendClientMessage(
      Color.error,
      `患者现金不足。需要 ${formatMoney(price)}.`
    );
    return;
  }

  clearExpiredMedhelpOffer(targetSlot);

  if (pendingOffers.has(targetSlot) || !claimYnOffer(targetSlot, "medhelp")) {
    player.sendClientMessage(Color.error, "该玩家已有有效报价。");
    return;
  }

  pendingOffers.set(targetSlot, {
    doctorId: doctorSlot,
    doctorUserId: account.id,
    price,
    expiresAt: Date.now() + OFFER_TTL_MS,
  });

  player.sendClientMessage(
    Color.info,
    `你向玩家 ${playerName(target)} 提议治疗，费用为 ${formatMoney(price)}.`
  );
  target.sendClientMessage(
    Color.white,
    `${playerName(player)} 提议为你治疗，费用为 ${formatMoney(price)}.`
  );
  target.sendClientMessage(
    Color.white,
    "按 {00CC00}Y {FFFFFF}接受，或按 {FF6600}N {FFFFFF}拒绝"
  );
}

function acceptOffer(patient: Player, patientSlot: number, offer: MedhelpOffer): void {
  pendingOffers.delete(patientSlot);
  releaseYnOffer(patientSlot, "medhelp");

  const patientAccount = getAccount(patient);
  if (!patientAccount || !isAuthenticated(patient)) {
    return;
  }

  const doctor = omp.players.at(offer.doctorId);
  if (!doctor || !isPlayerActive(doctor) || !isAuthenticated(doctor)) {
    patient.sendClientMessage(Color.error, "医生已退出游戏。治疗已取消。");
    return;
  }

  const doctorAccount = getAccount(doctor);
  if (!doctorAccount || doctorAccount.id !== offer.doctorUserId) {
    patient.sendClientMessage(Color.error, "医生已退出游戏。治疗已取消。");
    return;
  }

  const membership = getMembership(doctorAccount);
  if (!membership || membership.org.id !== ORG_HOSPITAL_ID) {
    patient.sendClientMessage(Color.error, "治疗已取消。");
    doctor.sendClientMessage(Color.error, "只有医院员工才能进行治疗。");
    return;
  }

  if (isJailed(doctor) || doctorAccount.hospitalized || isJailed(patient)) {
    patient.sendClientMessage(Color.error, "治疗已取消。");
    doctor.sendClientMessage(Color.error, "现在不能进行治疗。");
    return;
  }

  if (!arePlayersNearby(doctor, patient, WHISPER_RADIUS)) {
    patient.sendClientMessage(Color.error, "医生距离太远。治疗已取消。");
    doctor.sendClientMessage(Color.error, "患者距离太远。治疗已取消。");
    return;
  }

  if (!canHealHere(doctor) || !canHealHere(patient)) {
    patient.sendClientMessage(Color.error, "治疗已取消。");
    doctor.sendClientMessage(
      Color.error,
      "只能在医院或医院车辆内治疗。"
    );
    return;
  }

  let doctorInHospitalWorld = false;
  try {
    doctorInHospitalWorld = doctor.getVirtualWorld() === HOSPITAL_WORLD;
  } catch {
    return;
  }

  if (!doctorInHospitalWorld && !sameHospitalVehicle(doctor, patient)) {
    patient.sendClientMessage(Color.error, "治疗已取消。");
    doctor.sendClientMessage(
      Color.error,
      "患者必须和你在同一辆医院车辆内。"
    );
    return;
  }

  let patientHp = patientAccount.health;
  try {
    patientHp = patient.getHealth();
  } catch {
    // fallback
  }

  if (patientHp >= MAX_HEALTH - 0.5) {
    patient.sendClientMessage(Color.error, "你已经健康。");
    doctor.sendClientMessage(Color.error, "玩家已经健康。");
    return;
  }

  if (getCarriedHospitalMeds(doctor) < 1) {
    patient.sendClientMessage(Color.error, "医生没有药品。治疗已取消。");
    doctor.sendClientMessage(Color.error, "没有药品。");
    return;
  }

  const price = offer.price;
  if (patientAccount.money < price) {
    patient.sendClientMessage(
      Color.error,
      `现金不足。需要 ${formatMoney(price)}.`
    );
    doctor.sendClientMessage(
      Color.error,
      `${playerName(patient)} 无法支付治疗费用 (${formatMoney(price)}).`
    );
    return;
  }

  const livePatient = getAccount(patient);
  const liveDoctor = getAccount(doctor);
  if (
    !livePatient ||
    !liveDoctor ||
    livePatient.id !== patientAccount.id ||
    liveDoctor.id !== doctorAccount.id ||
    livePatient.money < price
  ) {
    patient.sendClientMessage(Color.error, "无法完成付款。");
    return;
  }

  const patientMoney = livePatient.money - price;
  const doctorMoney = liveDoctor.money + price;
  patchAccount(patient, { money: patientMoney });
  patchAccount(doctor, { money: doctorMoney });

  if (!consumeHospitalMed(doctor)) {
    patchAccount(patient, { money: livePatient.money });
    patchAccount(doctor, { money: liveDoctor.money });
    const rollbackPatient = getAccount(patient);
    const rollbackDoctor = getAccount(doctor);
    if (rollbackPatient) {
      applyWallet(patient, rollbackPatient);
    }
    if (rollbackDoctor) {
      applyWallet(doctor, rollbackDoctor);
    }
    patient.sendClientMessage(Color.error, "医生没有药品。治疗已取消。");
    doctor.sendClientMessage(Color.error, "没有药品。");
    return;
  }

  patchAccount(patient, { health: MAX_HEALTH });
  applyHealth(patient, MAX_HEALTH);
  // 否则 hospitalized 会一直为 true，满血患者也无法离开医院。
  dischargeHospitalPatient(patient);

  const patientWallet = getAccount(patient);
  const doctorWallet = getAccount(doctor);
  if (patientWallet) {
    applyWallet(patient, patientWallet);
  }
  if (doctorWallet) {
    applyWallet(doctor, doctorWallet);
  }
  queueSave(patient);
  queueSave(doctor);

  const left = getCarriedHospitalMeds(doctor);
  const verb = byGender(doctorAccount.gender, "治疗了", "治疗了");
  doctor.sendClientMessage(
    Color.info,
    `患者 ${playerName(patient)} 已治愈。+${formatMoney(price)}. 剩余药品: ${left}.`
  );
  patient.sendClientMessage(
    Color.info,
    `${playerName(doctor)} ${verb}了你。已支付 ${formatMoney(price)}.`
  );

  broadcastHospitalMed(membership.rank.title, doctor, patient, doctorAccount, price);
}

function refuseOffer(patient: Player, patientSlot: number, offer: MedhelpOffer): void {
  pendingOffers.delete(patientSlot);
  releaseYnOffer(patientSlot, "medhelp");
  patient.sendClientMessage(Color.gray, "你拒绝了治疗。");

  const doctor = omp.players.at(offer.doctorId);
  if (doctor && isPlayerActive(doctor)) {
    doctor.sendClientMessage(
      Color.gray,
      `${playerName(patient)} 拒绝了治疗。`
    );
  }
}

function clearExpiredMedhelpOffer(slot: number): void {
  const offer = pendingOffers.get(slot);
  if (!offer) {
    if (getYnOfferKind(slot) === "medhelp") {
      releaseYnOffer(slot, "medhelp");
    }
    return;
  }

  if (Date.now() <= offer.expiresAt) {
    return;
  }

  pendingOffers.delete(slot);
  releaseYnOffer(slot, "medhelp");
}

function broadcastHospitalMed(
  rankTitle: string,
  doctor: Player,
  patient: Player,
  doctorAccount: { gender: "male" | "female" },
  price: number
): void {
  const verb = byGender(doctorAccount.gender, "治疗了", "治疗了");
  const line = clipClientMessage(
    `（MED）${rankTitle} ${playerChatName(doctor)} ${verb} 玩家 ${playerChatName(patient)}。费用：${formatMoney(price)}。`
  );

  omp.players.forEach((other) => {
    if (!isPlayerActive(other)) {
      return;
    }

    try {
      if (other.isNPC()) {
        return;
      }
    } catch {
      return;
    }

    const otherAccount = getAccount(other);
    const otherOrg = otherAccount ? getMembership(otherAccount) : null;
    if (!otherOrg || otherOrg.org.id !== ORG_HOSPITAL_ID) {
      return;
    }

    try {
      other.sendClientMessage(Color.radio, line);
    } catch {
      // 槽位为空。
    }
  });
}

function canHealHere(player: Player): boolean {
  try {
    if (player.getVirtualWorld() === HOSPITAL_WORLD) {
      return true;
    }

    const state = player.getState();
    if (state !== PLAYER_STATE_DRIVER && state !== PLAYER_STATE_PASSENGER) {
      return false;
    }

    const vehicle = omp.vehicles.at(player.getVehicleID()) ?? null;
    if (!vehicle) {
      return false;
    }

    return isRegisteredOrgVehicle(vehicle, ORG_HOSPITAL_ID);
  } catch {
    return false;
  }
}

function sameHospitalVehicle(a: Player, b: Player): boolean {
  try {
    const stateA = a.getState();
    const stateB = b.getState();
    if (
      (stateA !== PLAYER_STATE_DRIVER && stateA !== PLAYER_STATE_PASSENGER) ||
      (stateB !== PLAYER_STATE_DRIVER && stateB !== PLAYER_STATE_PASSENGER)
    ) {
      return false;
    }

    const idA = a.getVehicleID();
    const idB = b.getVehicleID();
    if (idA !== idB) {
      return false;
    }

    const vehicle = omp.vehicles.at(idA) ?? null;
    return vehicle !== null && isRegisteredOrgVehicle(vehicle, ORG_HOSPITAL_ID);
  } catch {
    return false;
  }
}
