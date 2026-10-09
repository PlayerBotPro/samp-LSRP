import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { omp } from "@omp-node/core";
import { SERVER_TAG } from "../../shared/brand";
import type { GameModule } from "../types";
import { parsePawnMap, type MapBuildingRemove, type MapObjectDef } from "./pawn-map";
import { startObjectStream } from "./stream";

const MAPS_DIR = join(process.cwd(), "maps");

export const mappingModule: GameModule = {
  name: "mapping",
  start() {
    let files: string[] = [];

    try {
      files = readdirSync(MAPS_DIR).filter((name) => name.toLowerCase().endsWith(".txt"));
    } catch {
      omp.log(`[${SERVER_TAG}] 未找到 maps 文件夹`);
      return;
    }

    const objects: MapObjectDef[] = [];
    const removals: MapBuildingRemove[] = [];

    for (const file of files.sort()) {
      try {
        const source = readFileSync(join(MAPS_DIR, file), "utf8");
        const parsed = parsePawnMap(source);
        objects.push(...parsed.objects);
        removals.push(...parsed.removals);
        omp.log(
          `[${SERVER_TAG}] 地图 ${file}：流式加载 ${parsed.objects.length} 个对象，移除 ${parsed.removals.length} 个建筑`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        omp.log(`[${SERVER_TAG}] 地图 ${file} 加载失败：${message}`);
      }
    }

    startObjectStream(objects, removals);
    omp.log(
      `[${SERVER_TAG}] 对象流式加载器：共 ${objects.length} 个对象，移除 ${removals.length} 个建筑`
    );
  },
};
