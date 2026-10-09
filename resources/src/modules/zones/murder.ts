import { omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { isPlayerActive, playerChatName, playerId } from "../../shared/player";
import { byGender } from "../auth/gender";
import { getAccount, isAuthenticated } from "../auth/session";
import { setPlayerWantedLevel } from "../auth/wanted";
import { getMembership } from "../org";
import { isLawOfficer, notifyLawStaff } from "../org/law";
import { applyJail, isJailed } from "../prison/sentence";
import { clearPendingHospitalSpawn } from "../spawn";
import { isCaptureCombatKill, isCaptureParticipantOnTurf } from "./capture";
import { districtNameAt } from "./district";

const ALERT_SOUND_ID = 21001;
/** 与 /arrest 和自首相同：1★ = 10 分钟。 */
const MINUTES_PER_WANTED = 10;

function isPlayable(player: Player): boolean {
  if (!isPlayerActive(player) || !isAuthenticated(player)) {
    return false;
  }
  try {
    return !player.isNPC();
  } catch {
    return false;
  }
}

function districtLabelAt(player: Player): string {
  try {
    const pos = player.getPos();
    const name = districtNameAt(pos.x, pos.y);
    return name === "Unknown" ? "未知区域" : name;
  } catch {
    return "未知区域";
  }
}

function playAlertForLaw(): void {
  omp.players.forEach((officer) => {
    if (!isPlayable(officer) || !isLawOfficer(officer)) {
      return;
    }
    try {
      const pos = officer.getPos();
      officer.playGameSound(ALERT_SOUND_ID, pos.x, pos.y, pos.z);
    } catch {
      // 槽位为空。
    }
  });
}

function onPlayerMurder(victim: Player, killer: Player | null | undefined): void {
  if (!killer || !isPlayable(victim) || !isPlayable(killer)) {
    return;
  }

  if (playerId(victim) === playerId(killer)) {
    return;
  }

  // 警察 / LSPD / FBI：击毙通缉犯（不算警员犯罪）。
  if (isLawOfficer(killer)) {
    void tryLawNeutralize(victim, killer);
    return;
  }

  // 帮派争夺战中的击杀不算刑事谋杀。
  if (isCaptureCombatKill(victim, killer)) {
    return;
  }

  const account = getAccount(killer);
  if (!account) {
    return;
  }

  setPlayerWantedLevel(killer, account.wantedLevel + 1);
  notifyLawStaff(
    `嫌疑人 ${playerChatName(killer)} 在${districtLabelAt(victim)}实施了谋杀`
  );
  playAlertForLaw();
}

async function tryLawNeutralize(victim: Player, killer: Player): Promise<void> {
  // 不统计己方或其他执法机构成员。
  if (isLawOfficer(victim)) {
    return;
  }

  // 正在参与帮派争夺战的帮派成员不计入，即使其被通缉。
  if (isCaptureParticipantOnTurf(victim)) {
    return;
  }

  const victimAccount = getAccount(victim);
  if (!victimAccount || victimAccount.wantedLevel <= 0) {
    return;
  }

  if (isJailed(victim)) {
    return;
  }

  const wanted = victimAccount.wantedLevel;
  const minutes = Math.max(1, Math.floor(wanted)) * MINUTES_PER_WANTED;
  const district = districtLabelAt(victim);

  clearPendingHospitalSpawn(victim);

  const ok = await applyJail(victim, minutes);
  if (!ok) {
    return;
  }

  setPlayerWantedLevel(victim, 0);

  const killerAccount = getAccount(killer);
  const membership = killerAccount ? getMembership(killerAccount) : null;
  const rankTitle = membership?.rank.title ?? "警员";
  const verb = byGender(
    killerAccount?.gender ?? null,
    "击毙了",
    "击毙了"
  );

  notifyLawStaff(
    `${rankTitle} ${playerChatName(killer)}在${district}击毙了罪犯。`
  );
}

export function startMurderReports(): void {
  omp.on("playerDeath", (player, killer) => {
    onPlayerMurder(player, killer);
  });
}
