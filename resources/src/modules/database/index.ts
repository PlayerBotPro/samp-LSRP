import { omp } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import { connectDatabase } from "../../shared/database";
import type { GameModule } from "../types";

export const databaseModule: GameModule = {
  name: "database",
  async start() {
    try {
      await connectDatabase();
      omp.log(`[${SERVER_TAG}] MySQL 已连接`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      omp.log(`[${SERVER_TAG}] MySQL 未连接:${message}`);
      omp.log(`[${SERVER_TAG}] 请检查 .env(MYSQL_HOST,MYSQL_USER,MYSQL_PASSWORD,MYSQL_DATABASE)`);
    }
  },
};
