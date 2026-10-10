import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { omp } from "@omp-node/core";
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
      omp.log(`Maps directory not found`);
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
          `Map ${file}: streamed ${parsed.objects.length} objects, removed ${parsed.removals.length} buildings`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        omp.log(`Failed to load map ${file}: ${message}`);
      }
    }

    startObjectStream(objects, removals);
    omp.log(
      `Object streamer: ${objects.length} objects total, removed ${removals.length} buildings`
    );
  },
};
