import { omp } from "@omp-node/core";
import { playerName } from "../../shared/player";
import type { GameModule } from "../types";

export const sessionModule: GameModule = {
  name: "session",
  start() {
    omp.on("playerConnect", (player) => {
      omp.log(`${playerName(player)} connected`);
    });

    omp.on("playerDisconnect", (player) => {
      omp.log(`${playerName(player)} disconnected`);
    });
  },
};
