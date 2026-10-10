import type { Account } from "../auth/session";
import { resolveOrgSpawn } from "../org";
import { isJailedAccount, pickJailCell } from "../prison/sentence";
import { DEFAULT_SPAWN, pickHospitalSpawn, type SpawnPoint } from "./point";

/**
 * 玩家出生位置:监狱 → 医院 → 组织 → 默认出生点.
 * 与登录后的逻辑相同.
 */
export function resolveAccountSpawn(
  account: Account | null | undefined
): SpawnPoint {
  if (account && isJailedAccount(account)) {
    return pickJailCell();
  }

  if (account?.hospitalized) {
    return pickHospitalSpawn();
  }

  return resolveOrgSpawn(account) ?? DEFAULT_SPAWN;
}
