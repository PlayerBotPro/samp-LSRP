import { Class, omp, type Player } from "@omp-node/core";
import { Color } from "../../shared/colors";
import { playerId } from "../../shared/player";
import { holdAtAuth } from "../auth/flow";
import {
  HOSPITAL_HEALTH,
  MAX_HEALTH,
  applyHealth,
  applyScore,
  applyWantedLevel,
  applyWallet,
  getAccount,
  isAuthenticated,
  patchAccount,
} from "../auth/session";
import { queueSave } from "../persist";
import { applyOrgVisuals, resolveOrgSpawn, resolvePlayerSkin } from "../org";
import { isJailed, isJailedAccount, pickJailCell, placeInJail } from "../prison/sentence";
import { saveUserHospitalized } from "../auth/repository";
import { refreshStreamForPlayer } from "../mapping/stream";
import type { GameModule } from "../types";
import {
  DEFAULT_SPAWN,
  DEFAULT_SPAWN_SKIN,
  NO_TEAM,
  clearPlaceAtSettle,
  pickHospitalSpawn,
  placeAt,
  writeSpawnInfo,
  type SpawnPoint,
} from "./point";
import { startSpawnHealthPickup } from "./health";

const pendingHospital = new Map<number, SpawnPoint>();
const seenWorldSpawn = new Set<number>();

export const spawnModule: GameModule = {
  name: "spawn",
  start() {
    new Class(
      NO_TEAM,
      DEFAULT_SPAWN_SKIN,
      DEFAULT_SPAWN.x,
      DEFAULT_SPAWN.y,
      DEFAULT_SPAWN.z,
      DEFAULT_SPAWN.angle,
      0,
      0,
      0,
      0,
      0,
      0
    );

    startSpawnHealthPickup();

    omp.on("playerConnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        pendingHospital.delete(id);
        seenWorldSpawn.delete(id);
      }
    });

    omp.on("playerDeath", (player) => {
      if (!isAuthenticated(player)) {
        return;
      }

      const id = playerId(player);
      if (id === null) {
        return;
      }

      const account = getAccount(player);
      let skin = account ? resolvePlayerSkin(account) : undefined;
      if (skin === undefined) {
        try {
          skin = player.getSkin();
        } catch {
          skin = DEFAULT_SPAWN_SKIN;
        }
      }

      if (isJailed(player)) {
        pendingHospital.delete(id);
        try {
          writeSpawnInfo(player, skin, pickJailCell());
        } catch {
          // 玩家已离开。
        }
        patchAccount(player, { health: MAX_HEALTH });
        return;
      }

      const hospital = pickHospitalSpawn();
      pendingHospital.set(id, hospital);

      try {
        writeSpawnInfo(player, skin, hospital);
      } catch {
        // 玩家已离开。
      }

      patchAccount(player, { health: HOSPITAL_HEALTH, hospitalized: true });
      if (account) {
        void saveUserHospitalized(account.id, true, HOSPITAL_HEALTH);
      }
    });

    omp.on("playerSpawn", (player) => {
      if (!isAuthenticated(player)) {
        holdAtAuth(player);
        return;
      }

      const account = getAccount(player);
      const hospital = takePendingHospital(player);

      try {
        player.setTeam(NO_TEAM);
        applyOrgVisuals(player);
        if (account) {
          applyScore(player, account.level);
          applyWantedLevel(player, account.wantedLevel);
        }
        player.setCameraBehind();
      } catch {
        // 玩家已离开。
      }

      if (account && isJailedAccount(account)) {
        const id = playerId(player);
        const firstSpawn = id !== null && !seenWorldSpawn.has(id);
        if (id !== null) {
          seenWorldSpawn.add(id);
        }

        try {
          placeInJail(player);
          applyHealth(player, account.health);
        } catch {
          // 玩家已离开。
        }

        if (firstSpawn) {
          applyWallet(player, account);
        }

        player.sendClientMessage(Color.error, "你正在服刑。");
        return;
      }

      if (hospital) {
        try {
          placeAt(player, hospital);
          applyHealth(player, HOSPITAL_HEALTH);
          refreshStreamForPlayer(player);
        } catch {
          // 玩家已离开。
        }

        patchAccount(player, { health: HOSPITAL_HEALTH });
        queueSave(player);

        const id = playerId(player);
        if (id !== null) {
          seenWorldSpawn.add(id);
        }

        player.sendClientMessage(Color.info, "你失去了意识...");
        player.sendClientMessage(
          Color.gray,
          "医生将你送到了圣徒全体医院。"
        );
        player.sendClientMessage(Color.gray, "请占用一张病床: /hospital.");
        return;
      }

      if (account?.hospitalized) {
        try {
          const point = pickHospitalSpawn();
          placeAt(player, point);
          applyHealth(player, account.health);
          refreshStreamForPlayer(player);
        } catch {
          // 玩家已离开。
        }

        const id = playerId(player);
        const firstSpawn = id !== null && !seenWorldSpawn.has(id);
        if (id !== null) {
          seenWorldSpawn.add(id);
        }

        if (firstSpawn) {
          applyWallet(player, account);
        }

        player.sendClientMessage(
          Color.gray,
          "治疗尚未完成。请占用一张病床: /hospital."
        );
        return;
      }

      const id = playerId(player);
      const firstSpawn = id !== null && !seenWorldSpawn.has(id);
      if (id !== null && firstSpawn) {
        seenWorldSpawn.add(id);
      }

      if (account && firstSpawn) {
        applyWallet(player, account);
      }

      if (account) {
        applyHealth(player, account.health);
        if (firstSpawn) {
          const orgSpawn = resolveOrgSpawn(account);
          if (orgSpawn) {
            try {
              placeAt(player, orgSpawn);
              refreshStreamForPlayer(player);
            } catch {
              // 玩家已离开。
            }
          }
        }
      }
    });

    omp.on("playerDisconnect", (player) => {
      clearPlaceAtSettle(player);
      const id = playerId(player);
      if (id !== null) {
        pendingHospital.delete(id);
        seenWorldSpawn.delete(id);
      }
    });
  },
};

function takePendingHospital(player: Player): SpawnPoint | null {
  const id = playerId(player);
  if (id === null) {
    return null;
  }

  const hospital = pendingHospital.get(id);
  if (!hospital) {
    return null;
  }

  pendingHospital.delete(id);
  return hospital;
}

/** 重置死亡后延迟前往医院的出生流程（管理员使用 `/spawn` 等命令时）。 */
export function clearPendingHospitalSpawn(player: Player): void {
  const id = playerId(player);
  if (id !== null) {
    pendingHospital.delete(id);
  }
}
