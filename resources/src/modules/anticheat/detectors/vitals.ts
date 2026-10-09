import type { Player } from "@omp-node/core";
import { playerId } from "../../../shared/player";
import { getAccount } from "../../auth/session";
import { AcCode } from "../codes";
import { isCodeEnabled } from "../config";
import { nowMs } from "../math";
import { reportCheat } from "../punish";
import { getPlayerState } from "../state";

/** HP/护甲浮点数容差（这是数据包噪声，不是“免费治疗”）。 */
const VITALS_EPS = 1;

export function checkVitals(player: Player): void {
  const id = playerId(player);
  if (id === null) return;
  const state = getPlayerState(id);
  if (!state || !state.spawned || state.dead || state.spectating) return;

  const now = nowMs();
  let health: number;
  let armour: number;
  try {
    health = player.getHealth();
    armour = player.getArmor();
  } catch {
    return;
  }

  // 宽限期：等待服务器 SetHealth/伤害生效期间不踢出玩家。
  // 此时不会根据客户端数据提高镜像值，只依据 trust/onTakeDamage 更新。
  if (now >= state.healthTrustedUntil && isCodeEnabled(AcCode.HealthFoot)) {
    if (health > state.health + VITALS_EPS && health <= 255) {
      reportCheat(
        player,
        AcCode.HealthFoot,
        `hp=${health.toFixed(1)} exp=${state.health.toFixed(1)}`
      );
      return;
    }
  }

  if (now >= state.armourTrustedUntil && isCodeEnabled(AcCode.Armour)) {
    if (armour > state.armour + VITALS_EPS) {
      reportCheat(
        player,
        AcCode.Armour,
        `ar=${armour.toFixed(1)} exp=${state.armour.toFixed(1)}`
      );
    }
  }
}

export function checkMoney(player: Player): void {
  const id = playerId(player);
  if (id === null) return;
  const state = getPlayerState(id);
  if (!state || !state.spawned) return;
  if (!isCodeEnabled(AcCode.Money)) return;
  // 宽限期只会延迟踢出；金钱镜像以 account 为准，客户端不能提高预期值。
  if (nowMs() < state.moneyTrustedUntil) return;

  const account = getAccount(player);
  if (!account) return;

  let clientMoney: number;
  try {
    clientMoney = player.getMoney();
  } catch {
    return;
  }

  if (clientMoney > account.money) {
    reportCheat(
      player,
      AcCode.Money,
      `client=${clientMoney} server=${account.money}`
    );
    return;
  }

  state.money = account.money;
}
