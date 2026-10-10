import { omp, type Player } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { isDatabaseReady } from "../../shared/database";
import { playerId } from "../../shared/player";
import { isAuthenticated } from "../auth/session";
import type { GameModule } from "../types";
import { startAmmuShops } from "./ammu";
import { startBusinessEntrances } from "./enter";
import { startBusinessExits } from "./exits";
import { bindBusinessMapIcons, refreshBusinessMapIcons } from "./map-icons";
import { startBusinessMarkers } from "./markers";
import { bindBusinessMenu } from "./menu";
import { bindBusinessPurchase } from "./purchase";
import { ensureBusinessesTable, listBusinesses } from "./repository";
import { startShop247 } from "./shop-247";
import { startClothesShops } from "./clothes";
import { startGasStations } from "./gas";
import { startFastfoodShops } from "./fastfood";
import { startStreetFoodStalls } from "./street-food";
import { startWorkshopShops } from "./workshop";
import { clearInsideBusiness } from "./session";
import { notifyBusinessTaxReminder, startBusinessTaxScheduler } from "./tax";

const taxReminderShown = new Set<number>();

export const businessesModule: GameModule = {
  name: "businesses",
  async start() {
    if (!isDatabaseReady()) {
      omp.log(`Businesses: database unavailable`);
      return;
    }

    try {
      await ensureBusinessesTable();
      startBusinessMarkers();
      startBusinessEntrances();
      startBusinessExits();
      startStreetFoodStalls();
      startFastfoodShops();
      startGasStations();
      startAmmuShops();
      startShop247();
      startClothesShops();
      startWorkshopShops();
      bindBusinessMapIcons();
      bindBusinessPurchase();
      bindBusinessMenu();
      startBusinessTaxScheduler();
      omp.log(`Businesses: loaded ${listBusinesses().length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      omp.log(`Businesses: failed to load - ${message}`);
    }

    omp.on("playerSpawn", (player) => {
      refreshBusinessMapIcons(player);
      remindBusinessTaxOnLogin(player);
    });

    // 死亡或重生会离开室内,否则会话会阻止离开或收回企业.
    omp.on("playerDeath", (player) => {
      const id = playerId(player);
      if (id !== null) {
        clearInsideBusiness(id);
      }
    });

    omp.on("playerDisconnect", (player) => {
      const id = playerId(player);
      if (id !== null) {
        taxReminderShown.delete(id);
        clearInsideBusiness(id);
      }
    });
  },
};

function remindBusinessTaxOnLogin(player: Player): void {
  if (!isAuthenticated(player)) {
    return;
  }

  const id = playerId(player);
  if (id === null || taxReminderShown.has(id)) {
    return;
  }

  taxReminderShown.add(id);
  notifyBusinessTaxReminder(player);
}
