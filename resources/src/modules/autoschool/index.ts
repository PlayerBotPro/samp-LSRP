import {
  Checkpoint,
  Dialog,
  omp,
  RaceCheckpoint,
  TextLabel,
  type Player,
  type Vehicle,
} from "@omp-node/core";
import { Color } from "../../shared/colors";
import { SERVER_TAG } from "../../shared/brand";
import { isPlayerActive, playerId } from "../../shared/player";
import { applyWallet, getAccount, isAuthenticated, patchAccount } from "../auth/session";
import { saveUserLicenses, saveUserMoney } from "../auth/repository";
import { isLoaderOnShift } from "../loader";
import { isMinerOnShift } from "../miner";
import { AUTOSCHOOL_INTERIOR } from "../org/autoschool";
import { isJailed } from "../prison/sentence";
import { STREET_WORLD } from "../spawn/point";
import { isAutoschoolFleetVehicle } from "../vehicles/autoschool";
import type { GameModule } from "../types";
import { EXAM_RULES, examQuestions } from "./questions";
import { EXAM_ROUTE } from "./route";
import {
  exams,
  getExam,
  kindFromModel,
  type ExamKind,
  type ExamSession,
} from "./session";

export {
  autoschoolExamVehicleDeny,
  canEnterAutoschoolExamVehicle,
  isAutoschoolExamOnRoute,
} from "./session";

export const AUTOSCHOOL_EXAM_KIND_DIALOG_ID = 32;
export const AUTOSCHOOL_EXAM_RULES_DIALOG_ID = 33;
export const AUTOSCHOOL_EXAM_QUESTION_DIALOG_ID = 34;
export const AUTOSCHOOL_EXAM_RESULT_DIALOG_ID = 35;

const DIALOG_STYLE_MSGBOX = 0;
const DIALOG_STYLE_LIST = 2;
const MARKER = { x: -2026.7548, y: -114.3427, z: 1035.1719 };
const MARKER_RADIUS = 1.6;
const INTERIOR_RANGE = 40;
const CHECKPOINT_RADIUS = 1.5;
const RACE_CP_RADIUS = 8;
const RACE_CP_NORMAL = 0;
const RACE_CP_FINISH = 1;
const PLAYER_STATE_ONFOOT = 1;
const PLAYER_STATE_DRIVER = 2;
const TICK_MS = 200;
const LABEL_HEIGHT = 0.9;
const LABEL_DRAW_DISTANCE = 18;
const QUESTION_COUNT = 5;
const THEORY_FEE = 500;
const DRIVE_TTL_MS = 10 * 60 * 1000;

const standingOnMarker = new Set<number>();
const startMarkerOn = new Set<number>();
const busy = new Set<number>();

function tell(player: Player, color: number, text: string): void {
  try {
    if (isPlayerActive(player)) {
      player.sendClientMessage(color, text);
    }
  } catch {
    // 槽位为空.
  }
}

function inSchoolInterior(player: Player): boolean {
  try {
    if (player.getVirtualWorld() !== STREET_WORLD) {
      return false;
    }

    if (player.getInterior() !== AUTOSCHOOL_INTERIOR) {
      return false;
    }

    const pos = player.getPos();
    return Math.hypot(pos.x - MARKER.x, pos.y - MARKER.y, pos.z - MARKER.z) <= INTERIOR_RANGE;
  } catch {
    return false;
  }
}

function atMarker(player: Player): boolean {
  try {
    if (player.getState() !== PLAYER_STATE_ONFOOT) {
      return false;
    }

    if (!inSchoolInterior(player)) {
      return false;
    }

    const pos = player.getPos();
    return Math.hypot(pos.x - MARKER.x, pos.y - MARKER.y, pos.z - MARKER.z) <= MARKER_RADIUS;
  } catch {
    return false;
  }
}

function showDialog(
  player: Player,
  id: number,
  style: number,
  title: string,
  body: string,
  button1: string,
  button2: string
): boolean {
  try {
    Dialog.show(player, id, style, title, body, button1, button2);
    return true;
  } catch {
    tell(player, Color.error, "无法打开考试窗口.");
    return false;
  }
}

function clearRace(player: Player): void {
  try {
    RaceCheckpoint.disable(player);
  } catch {
    // 槽位为空.
  }
}

function abortExam(player: Player, message: string | null): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const exam = exams.get(id);
  exams.delete(id);
  clearRace(player);

  if (exam && message) {
    tell(player, Color.error, message);
  }
}

function liveVehicle(player: Player): Vehicle | null {
  try {
    if (!player.isInAnyVehicle()) {
      return null;
    }

    return omp.vehicles.at(player.getVehicleID()) ?? null;
  } catch {
    return null;
  }
}

function vehicleNumericId(vehicle: Vehicle): number | null {
  try {
    const id = vehicle.getID();
    if (id === null || id === undefined) {
      return null;
    }

    const numeric = Number(id);
    return Number.isInteger(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

function showRaceCp(player: Player, exam: ExamSession): void {
  const point = EXAM_ROUTE[exam.cpIndex];
  if (!point) {
    return;
  }

  const last = exam.cpIndex >= EXAM_ROUTE.length - 1;
  const next = last ? point : EXAM_ROUTE[exam.cpIndex + 1];
  if (!next) {
    return;
  }

  try {
    RaceCheckpoint.set(
      player,
      last ? RACE_CP_FINISH : RACE_CP_NORMAL,
      point.x,
      point.y,
      point.z,
      next.x,
      next.y,
      next.z,
      RACE_CP_RADIUS
    );
  } catch {
    tell(player, Color.error, "无法设置检查点.");
  }
}

function beginRoute(player: Player, exam: ExamSession, vehicle: Vehicle): void {
  const vehicleId = vehicleNumericId(vehicle);
  if (vehicleId === null) {
    return;
  }

  const already = exam.vehicleId === vehicleId;
  exam.vehicleId = vehicleId;
  if (already) {
    return;
  }

  try {
    Checkpoint.disable(player);
  } catch {
    // GPS/miner.
  }
  showRaceCp(player, exam);
  if (exam.cpIndex === 0) {
    tell(
      player,
      Color.info,
      "沿着箭头依次通过所有红色检查点,直到路线终点."
    );
  }
}

function availableKinds(player: Player): ExamKind[] {
  const account = getAccount(player);
  if (!account) {
    return [];
  }

  const kinds: ExamKind[] = [];
  if (!account.licenses.car) {
    kinds.push("car");
  }
  if (!account.licenses.moto) {
    kinds.push("moto");
  }
  return kinds;
}

function kindLabel(kind: ExamKind): string {
  return kind === "car" ? "汽车" : "摩托车";
}

function openKindMenu(player: Player): void {
  const kinds = availableKinds(player);
  if (kinds.length === 0) {
    tell(player, Color.error, "你已经持有汽车和摩托车驾照.");
    return;
  }

  const id = playerId(player);
  const account = getAccount(player);
  if (id === null || !account) {
    return;
  }

  exams.set(id, {
    accountId: account.id,
    kind: kinds[0] ?? "car",
    phase: "test",
    question: -1,
    correct: 0,
    vehicleId: null,
    cpIndex: 0,
    driveUntil: null,
  });

  showDialog(
    player,
    AUTOSCHOOL_EXAM_KIND_DIALOG_ID,
    DIALOG_STYLE_LIST,
    `交通规则考试 - $${THEORY_FEE}`,
    kinds.map(kindLabel).join("\n"),
    "下一步",
    "取消"
  );
}

function openRules(player: Player, exam: ExamSession): void {
  exam.question = -1;
  exam.correct = 0;
  showDialog(
    player,
    AUTOSCHOOL_EXAM_RULES_DIALOG_ID,
    DIALOG_STYLE_MSGBOX,
    "交通规则",
    EXAM_RULES,
    "下一步",
    "取消"
  );
}

function openQuestion(player: Player, exam: ExamSession): void {
  const questions = examQuestions(exam.kind);
  const item = questions[exam.question];
  if (!item) {
    finishTheory(player, exam);
    return;
  }

  tell(player, Color.info, item.text);
  showDialog(
    player,
    AUTOSCHOOL_EXAM_QUESTION_DIALOG_ID,
    DIALOG_STYLE_LIST,
    `问题 ${exam.question + 1}/${QUESTION_COUNT}`,
    item.answers.join("\n"),
    "提交答案",
    "取消"
  );
}

function finishTheory(player: Player, exam: ExamSession): void {
  const total = QUESTION_COUNT;
  if (exam.correct < total) {
    const slot = playerId(player);
    if (slot !== null) {
      exams.delete(slot);
    }
    showDialog(
      player,
      AUTOSCHOOL_EXAM_RESULT_DIALOG_ID,
      DIALOG_STYLE_MSGBOX,
      "考试",
      `你未能通过测试.\n答对题数:${exam.correct}/${total}.`,
      "关闭",
      ""
    );
    return;
  }

  exam.phase = "drive";
  exam.vehicleId = null;
  exam.driveUntil = Date.now() + DRIVE_TTL_MS;
  tell(
    player,
    Color.info,
    exam.kind === "car"
      ? "你已通过理论考试.请前往停车场,坐上驾校汽车."
      : "你已通过理论考试.请前往停车场,坐上驾校摩托车."
  );
}

function tryStartMarker(player: Player): void {
  const id = playerId(player);
  if (id === null || !isAuthenticated(player)) {
    return;
  }

  if (!atMarker(player)) {
    standingOnMarker.delete(id);
    return;
  }

  if (standingOnMarker.has(id)) {
    return;
  }

  standingOnMarker.add(id);

  if (isJailed(player)) {
    tell(player, Color.error, "你目前在监狱中.");
    return;
  }

  const account = getAccount(player);
  if (account?.hospitalized) {
    tell(player, Color.error, "你需要治疗.请使用 /hospital 占用病床.");
    return;
  }

  if (isMinerOnShift(player)) {
    tell(player, Color.error, "请先结束矿场的工作班次.");
    return;
  }

  if (isLoaderOnShift(player)) {
    tell(player, Color.error, "请先结束搬运工的工作班次.");
    return;
  }

  const cash = Math.max(0, Math.floor(account?.money ?? 0));
  if (cash < THEORY_FEE) {
    tell(player, Color.error, `交通规则考试费用为 $${THEORY_FEE},现金不足.`);
    return;
  }

  const exam = getExam(player);
  if (exam?.phase === "drive") {
    tell(
      player,
      Color.info,
      exam.kind === "car"
        ? "请前往停车场,坐上驾校汽车."
        : "请前往停车场,坐上驾校摩托车."
    );
    return;
  }

  if (exam?.phase === "test") {
    return;
  }

  openKindMenu(player);
}

function syncStartMarker(player: Player): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  if (shouldShowStartMarker(player)) {
    try {
      Checkpoint.set(player, MARKER.x, MARKER.y, MARKER.z, CHECKPOINT_RADIUS);
      startMarkerOn.add(id);
    } catch {
      // 槽位为空.
    }
    return;
  }

  if (!startMarkerOn.has(id)) {
    return;
  }

  startMarkerOn.delete(id);
  if (isMinerOnShift(player) || isLoaderOnShift(player) || isAutoschoolExamOnRouteLocal(player)) {
    return;
  }

  try {
    Checkpoint.disable(player);
  } catch {
    // GPS sam vkluchit metku.
  }
}

function shouldShowStartMarker(player: Player): boolean {
  if (isMinerOnShift(player) || isLoaderOnShift(player) || isAutoschoolExamOnRouteLocal(player)) {
    return false;
  }

  const exam = getExam(player);
  if (exam?.phase === "drive") {
    return false;
  }

  return inSchoolInterior(player);
}

function isAutoschoolExamOnRouteLocal(player: Player): boolean {
  const exam = getExam(player);
  return exam?.phase === "drive" && exam.vehicleId !== null;
}

function onKindPicked(player: Player, response: number, listItem: number, inputText: string): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const exam = exams.get(id);
  if (response === 0 || !exam) {
    exams.delete(id);
    return;
  }

  const kinds = availableKinds(player);
  let kind = kinds[listItem];
  const typed = inputText.trim().toLowerCase();
  if (typed) {
    const byLabel = kinds.find((item) => kindLabel(item).toLowerCase() === typed);
    if (byLabel) {
      kind = byLabel;
    }
  }

  if (!kind) {
    exams.delete(id);
    tell(player, Color.error, "请选择汽车或摩托车.");
    return;
  }

  const account = getAccount(player);
  if (!account || account.licenses[kind]) {
    exams.delete(id);
    tell(player, Color.error, "你已经持有此驾照.");
    return;
  }

  exam.kind = kind;
  exam.accountId = account.id;
  openRules(player, exam);
}

function onRules(player: Player, response: number): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const exam = exams.get(id);
  if (response === 0 || !exam || exam.phase !== "test") {
    exams.delete(id);
    return;
  }

  void startPaidTest(player, exam);
}

async function startPaidTest(player: Player, exam: ExamSession): Promise<void> {
  const account = getAccount(player);
  if (!account || account.id !== exam.accountId) {
    abortExam(player, "考试已中止.");
    return;
  }

  if (account.licenses[exam.kind]) {
    abortExam(player, "你已经持有此驾照.");
    return;
  }

  if (busy.has(account.id)) {
    tell(player, Color.error, "请稍候,另一项操作正在进行中.");
    return;
  }

  if (!inSchoolInterior(player)) {
    abortExam(player, "只能在驾校支付考试费用.");
    return;
  }

  const cash = Math.max(0, Math.floor(account.money));
  if (cash < THEORY_FEE) {
    abortExam(player, `交通规则考试费用为 $${THEORY_FEE},现金不足.`);
    return;
  }

  const nextCash = cash - THEORY_FEE;
  busy.add(account.id);
  try {
    await saveUserMoney(account.id, nextCash, account.bank);
  } catch (error: unknown) {
    busy.delete(account.id);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] autoschool fee ${account.name}: ${message}`);
    abortExam(player, "考试费用支付失败,请重试.");
    return;
  }
  busy.delete(account.id);

  const id = playerId(player);
  if (
    id === null ||
    !isPlayerActive(player) ||
    getAccount(player)?.id !== account.id ||
    exams.get(id) !== exam
  ) {
    return;
  }

  patchAccount(player, { money: nextCash });
  const live = getAccount(player);
  if (live) {
    applyWallet(player, live);
  }

  tell(player, Color.info, `你已支付交通规则考试费用:$${THEORY_FEE}.`);
  exam.question = 0;
  exam.correct = 0;
  openQuestion(player, exam);
}

function onAnswer(player: Player, response: number, listItem: number, inputText: string): void {
  const id = playerId(player);
  if (id === null) {
    return;
  }

  const exam = exams.get(id);
  if (response === 0 || !exam || exam.phase !== "test") {
    exams.delete(id);
    return;
  }

  const item = examQuestions(exam.kind)[exam.question];
  if (!item) {
    exams.delete(id);
    return;
  }

  let picked = listItem;
  const typed = inputText.trim().toLowerCase();
  if (typed) {
    const byText = item.answers.findIndex((answer) => answer.toLowerCase() === typed);
    if (byText >= 0) {
      picked = byText;
    }
  }

  if (picked === item.correct) {
    exam.correct += 1;
  }

  exam.question += 1;
  if (exam.question >= QUESTION_COUNT) {
    finishTheory(player, exam);
    return;
  }

  openQuestion(player, exam);
}

function onDriver(player: Player): void {
  const exam = getExam(player);
  if (!exam || exam.phase !== "drive") {
    return;
  }

  const vehicle = liveVehicle(player);
  if (!vehicle) {
    return;
  }

  try {
    if (player.getState() !== PLAYER_STATE_DRIVER) {
      return;
    }

    if (!isAutoschoolFleetVehicle(vehicle)) {
      return;
    }

    if (kindFromModel(vehicle.getModel()) !== exam.kind) {
      tell(
        player,
        Color.error,
        exam.kind === "car"
          ? "考试需要一辆汽车."
          : "考试需要一辆摩托车."
      );
      return;
    }
  } catch {
    return;
  }

  beginRoute(player, exam, vehicle);
}

function onLeftVehicle(player: Player): void {
  const exam = getExam(player);
  if (!exam || exam.phase !== "drive" || exam.vehicleId === null) {
    return;
  }

  exam.vehicleId = null;
  clearRace(player);
  tell(player, Color.error, "你已离开车辆.请重新上车以继续考试.");
}

function onRaceEnter(player: Player): void {
  const exam = getExam(player);
  if (!exam || exam.phase !== "drive" || exam.vehicleId === null) {
    return;
  }

  if (exam.cpIndex >= EXAM_ROUTE.length) {
    return;
  }

  try {
    if (player.getState() !== PLAYER_STATE_DRIVER) {
      return;
    }

    const vehicle = liveVehicle(player);
    if (!vehicle || vehicleNumericId(vehicle) !== exam.vehicleId) {
      return;
    }
  } catch {
    return;
  }

  exam.cpIndex += 1;
  if (exam.cpIndex >= EXAM_ROUTE.length) {
    void finishPractice(player, exam);
    return;
  }

  showRaceCp(player, exam);
}

async function finishPractice(player: Player, exam: ExamSession): Promise<void> {
  const id = playerId(player);
  const account = getAccount(player);
  if (id === null || !account || account.id !== exam.accountId) {
    abortExam(player, "考试已中止.");
    return;
  }

  if (account.licenses[exam.kind]) {
    abortExam(player, "你已经持有此驾照.");
    return;
  }

  if (busy.has(account.id)) {
    exam.cpIndex = Math.max(0, EXAM_ROUTE.length - 1);
    showRaceCp(player, exam);
    tell(player, Color.error, "请稍候,另一项操作正在进行中.");
    return;
  }

  const vehicle = liveVehicle(player);
  const nextLicenses = { ...account.licenses, [exam.kind]: true };

  busy.add(account.id);
  try {
    await saveUserLicenses(account.id, nextLicenses);
  } catch (error: unknown) {
    busy.delete(account.id);
    exam.cpIndex = EXAM_ROUTE.length - 1;
    showRaceCp(player, exam);
    const message = error instanceof Error ? error.message : String(error);
    omp.log(`[${SERVER_TAG}] autoschool exam ${account.name}: ${message}`);
    tell(player, Color.error, "无法保存驾照,请重试.");
    return;
  }
  busy.delete(account.id);

  exams.delete(id);
  clearRace(player);

  try {
    player.removeFromVehicle();
  } catch {
    // 玩家已经下车.
  }

  if (vehicle) {
    try {
      vehicle.setToRespawn();
    } catch {
      // 车辆已经销毁.
    }
  }

  if (!isPlayerActive(player) || getAccount(player)?.id !== account.id) {
    return;
  }

  patchAccount(player, { licenses: nextLicenses });
  tell(player, Color.info, "你已成功通过实操考试.");
  tell(
    player,
    Color.info,
    exam.kind === "car"
      ? "你已获得汽车驾照."
      : "你已获得摩托车驾照."
  );
}

export const autoschoolModule: GameModule = {
  name: "autoschool",
  start() {
    new TextLabel(
      "考试\n驾照",
      Color.info,
      MARKER.x,
      MARKER.y,
      MARKER.z + LABEL_HEIGHT,
      LABEL_DRAW_DISTANCE,
      STREET_WORLD,
      false
    );

    setInterval(tickExam, TICK_MS);

    omp.on("dialogResponse", (player, dialogId, response, listItem, inputText) => {
      const id = Number(dialogId);
      if (
        id !== AUTOSCHOOL_EXAM_KIND_DIALOG_ID &&
        id !== AUTOSCHOOL_EXAM_RULES_DIALOG_ID &&
        id !== AUTOSCHOOL_EXAM_QUESTION_DIALOG_ID &&
        id !== AUTOSCHOOL_EXAM_RESULT_DIALOG_ID
      ) {
        return;
      }

      if (id === AUTOSCHOOL_EXAM_KIND_DIALOG_ID) {
        onKindPicked(player, Number(response), Number(listItem), String(inputText ?? ""));
        return;
      }

      if (id === AUTOSCHOOL_EXAM_RULES_DIALOG_ID) {
        onRules(player, Number(response));
        return;
      }

      if (id === AUTOSCHOOL_EXAM_QUESTION_DIALOG_ID) {
        onAnswer(player, Number(response), Number(listItem), String(inputText ?? ""));
        return;
      }
    });

    omp.on("playerEnterRaceCheckpoint", (player) => {
      onRaceEnter(player);
    });

    omp.on("playerStateChange", (player, newState, oldState) => {
      if (newState === PLAYER_STATE_DRIVER) {
        onDriver(player);
        return;
      }

      if (oldState === PLAYER_STATE_DRIVER && newState !== PLAYER_STATE_DRIVER) {
        onLeftVehicle(player);
      }
    });

    omp.on("playerDeath", (player) => {
      abortExam(player, "考试已中止.");
    });

    omp.on("playerConnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        exams.delete(id);
        standingOnMarker.delete(id);
        startMarkerOn.delete(id);
      }
    });

    omp.on("playerDisconnect", (player) => {
      abortExam(player, null);
      const id = playerId(player);
      if (id !== null) {
        standingOnMarker.delete(id);
        startMarkerOn.delete(id);
      }
    });
  },
};

function tickExam(): void {
  omp.players.forEach((player) => {
    if (!isPlayerActive(player) || !isAuthenticated(player)) {
      return;
    }

    const exam = getExam(player);
    if (exam?.phase === "drive" && exam.driveUntil !== null && Date.now() > exam.driveUntil) {
      abortExam(player, "实操考试时间已到.");
      return;
    }

    const account = getAccount(player);
    if (exam && account?.hospitalized) {
      abortExam(player, "考试已中止:你需要治疗.");
      return;
    }

    if (exam && isJailed(player)) {
      abortExam(player, "考试已中止.");
      return;
    }

    syncStartMarker(player);
    tryStartMarker(player);
  });
}
