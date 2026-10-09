import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { WHISPER_RADIUS, arePlayersNearby } from "../../shared/nearby";
import { isPlayerActive, playerId } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { isCuffed } from "../cuff";
import { canLawSearchTarget, isLawOfficer } from "../org/law";
import { isJailed } from "../prison/sentence";

const DENY = "Команда доступна сотрудникам полиции и FBI.";
const PLAYER_STATE_WASTED = 7;
const PLAYER_STATE_SPECTATING = 9;

export type LawTargetResult =
  | { ok: true; officer: Player; target: Player; officerId: number; targetId: number }
  | { ok: false };

/** Общий разбор `/cmd [id]` для law-обыска / изъятия / наручников. */
export function resolveLawNearbyTarget(
  officer: Player,
  args: string,
  usage: string
): LawTargetResult {
  if (!isAuthenticated(officer) || !isLawOfficer(officer)) {
    officer.sendClientMessage(Color.error, DENY);
    return { ok: false };
  }

  if (isJailed(officer)) {
    officer.sendClientMessage(Color.error, "在监狱里无法使用此命令。");
    return { ok: false };
  }

  if (isCuffed(officer)) {
    officer.sendClientMessage(Color.error, "戴着手铐时无法使用此命令。");
    return { ok: false };
  }

  const raw = args.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    officer.sendClientMessage(Color.error, usage);
    return { ok: false };
  }

  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 0) {
    officer.sendClientMessage(Color.error, usage);
    return { ok: false };
  }

  const officerId = playerId(officer);
  if (officerId === null) {
    return { ok: false };
  }

  if (slot === officerId) {
    officer.sendClientMessage(Color.error, "不能对自己使用。");
    return { ok: false };
  }

  const target = findPlayer(slot);
  if (!target) {
    officer.sendClientMessage(Color.error, "未找到玩家。");
    return { ok: false };
  }

  try {
    const officerState = officer.getState();
    if (
      officerState === PLAYER_STATE_WASTED ||
      officerState === PLAYER_STATE_SPECTATING
    ) {
      officer.sendClientMessage(Color.error, "当前无法使用此命令。");
      return { ok: false };
    }

    const targetState = target.getState();
    if (
      targetState === PLAYER_STATE_WASTED ||
      targetState === PLAYER_STATE_SPECTATING
    ) {
      officer.sendClientMessage(Color.error, "玩家不在线。");
      return { ok: false };
    }
  } catch {
    officer.sendClientMessage(Color.error, "未找到玩家。");
    return { ok: false };
  }

  if (!arePlayersNearby(officer, target, WHISPER_RADIUS)) {
    officer.sendClientMessage(Color.error, "玩家距离太远。");
    return { ok: false };
  }

  if (!canLawSearchTarget(officer, target)) {
    officer.sendClientMessage(
      Color.error,
      "警察只能对平民使用此命令。FBI 可以对任何人使用（包括警察）。"
    );
    return { ok: false };
  }

  const targetId = playerId(target);
  if (targetId === null) {
    return { ok: false };
  }

  return { ok: true, officer, target, officerId, targetId };
}

function findPlayer(slot: number): Player | null {
  try {
    const target = omp.players.at(slot);
    if (!target || !isPlayerActive(target) || !isAuthenticated(target)) {
      return null;
    }

    if (target.isNPC()) {
      return null;
    }

    if (!getAccount(target)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}
