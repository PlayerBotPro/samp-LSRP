import type { Player } from "@omp-node/core";
import type { Account } from "../auth/session";
import { getAccount } from "../auth/session";
import { Color } from "../../shared/colors";
import { applyMaskVisuals, isMasked } from "../mask";
import {
  applyArmyDisguiseVisuals,
  syncArmyDisguise,
} from "./army-disguise";
import { getMembership } from "./membership";

const CIVILIAN_COLOR = 0xffffffff;
const JAIL_SKIN_MALE = 42;
const JAIL_SKIN_FEMALE = 69;

export function resolvePlayerSkin(account: Account): number {
  if (account.jailSeconds > 0) {
    return account.gender === "female" ? JAIL_SKIN_FEMALE : JAIL_SKIN_MALE;
  }

  const membership = getMembership(account);
  if (!membership) {
    return account.skin;
  }

  return account.gender === "female"
    ? membership.rank.skins.female
    : membership.rank.skins.male;
}

export function resolveNametagColor(account: Account): number {
  return getMembership(account)?.org.color ?? CIVILIAN_COLOR;
}

export function resolveChatColor(account: Account): number {
  return getMembership(account)?.org.color ?? Color.chat;
}

export function applyOrgVisuals(player: Player): void {
  const account = getAccount(player);
  if (!account) {
    return;
  }

  // 军队伪装(帮派):使用军队皮肤和颜色,但不改变帮派成员身份.
  if (syncArmyDisguise(player)) {
    applyArmyDisguiseVisuals(player, account);
  } else {
    try {
      player.setSkin(resolvePlayerSkin(account));
      player.setColor(resolveNametagColor(account));
    } catch {
      // 该槽位中的玩家尚未进入游戏.
    }
  }

  // 伪装会覆盖颜色(并将 alpha 设为 0,从小地图隐藏).
  if (isMasked(player)) {
    applyMaskVisuals(player);
  }
}
