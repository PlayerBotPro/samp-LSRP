import { omp, type Player } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { isDatabaseReady } from "../../shared/database";
import { playerId } from "../../shared/player";
import { isAuthenticated } from "../auth/session";
import type { GameModule } from "../types";
import { startHouseEntrances } from "./entrances";
import { startHouseExits } from "./exits";
import { bindHouseMenuDialogs } from "./menu";
import { bindHouseSellDialog } from "./sell";
import { bindHouseMapIcons, refreshHouseMapIcons } from "./map-icons";
import { notifyHouseRentReminder, startHouseRentScheduler } from "./rent";
import { ensureHousesTable, listHouses } from "./repository";
import { bindHouseStoreDialogs } from "./store";
import { startHouseStoreDisplays } from "./store-display";

const rentReminderShown = new Set<number>();

export const housesModule: GameModule = {
  name: "houses",
  async start() {
    if (!isDatabaseReady()) {
      omp.log(`Houses: database unavailable`);
      return;
    }

    try {
      await ensureHousesTable();
      startHouseEntrances();
      startHouseExits();
      startHouseStoreDisplays();
      bindHouseStoreDialogs();
      bindHouseMapIcons();
      bindHouseMenuDialogs();
      bindHouseSellDialog();
      startHouseRentScheduler();
      omp.log(`Houses: loaded ${listHouses().length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      omp.log(`Houses: failed to load - ${message}`);
    }

    omp.on("playerSpawn", (player) => {
      refreshHouseMapIcons(player);
      remindHouseRentOnLogin(player);
    });

    omp.on("playerDisconnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        rentReminderShown.delete(id);
      }
    });
  },
};

function remindHouseRentOnLogin(player: Player): void {
  if (!isAuthenticated(player)) {
    return;
  }

  const id = playerId(player);
  if (id === null || rentReminderShown.has(id)) {
    return;
  }

  rentReminderShown.add(id);
  notifyHouseRentReminder(player);
}
