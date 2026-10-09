import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { clipClientMessage } from "../../shared/nearby";
import { isPlayerActive } from "../../shared/player";
import { getAccount, isAuthenticated } from "../auth/session";
import { getMembership } from "./membership";
import { LAW_ORG_IDS } from "./lspd";
import { ORG_FBI_ID } from "./fbi";

const LAW_ORG_SET = new Set<number>(LAW_ORG_IDS);

export function isLawOfficer(player: Player): boolean {
  const account = getAccount(player);
  if (!account || !isAuthenticated(player)) {
    return false;
  }
  const orgId = getMembership(account)?.org.id;
  return orgId !== undefined && LAW_ORG_SET.has(orgId);
}

export function isFbiOfficer(player: Player): boolean {
  const account = getAccount(player);
  if (!account || !isAuthenticated(player)) {
    return false;
  }

  return getMembership(account)?.org.id === ORG_FBI_ID;
}

/**
 * FBI 可针对任何人；警察（LSPD / 州警察）仅可针对非执法人员（“普通”玩家).
 */
export function canLawSearchTarget(officer: Player, target: Player): boolean {
  if (!isLawOfficer(officer)) {
    return false;
  }

  if (isFbiOfficer(officer)) {
    return true;
  }

  return !isLawOfficer(target);
}

/** “FBI”或“警察”（LSPD / 州警察). */
export function lawOfficerLabel(player: Player): string {
  const account = getAccount(player);
  const orgId = account ? getMembership(account)?.org.id : undefined;
  return orgId === ORG_FBI_ID ? "FBI" : "警察";
}

/** 向所有在线的 LSPD / 州警察 / FBI 成员发送消息。 */
export function notifyLawStaff(line: string, color: number = Color.dept): void {
  const text = clipClientMessage(line);
  omp.players.forEach((officer) => {
    if (!isPlayerActive(officer) || !isLawOfficer(officer)) {
      return;
    }
    try {
      if (officer.isNPC()) {
        return;
      }
      officer.sendClientMessage(color, text);
    } catch {
      // 槽位为空。
    }
  });
}
