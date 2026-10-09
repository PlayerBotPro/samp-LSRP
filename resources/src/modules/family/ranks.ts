import { MAX_FAMILY_RANK, MIN_FAMILY_RANK, type FamilyRankDef } from "./types";

const FAMILY_RANKS: readonly FamilyRankDef[] = [
  { id: 1, title: "小混混" },
  { id: 2, title: "兄弟" },
  { id: 3, title: "自己人" },
  { id: 4, title: "老手" },
  { id: 5, title: "有威望者" },
  { id: 6, title: "监督者" },
  { id: 7, title: "队长" },
  { id: 8, title: "左右手" },
  { id: 9, title: "副手" },
  { id: 10, title: "老大" },
];

export function getFamilyRank(rankId: number): FamilyRankDef | null {
  const id = Math.floor(rankId);
  if (id < MIN_FAMILY_RANK || id > MAX_FAMILY_RANK) {
    return null;
  }

  return FAMILY_RANKS[id - 1] ?? null;
}

export function allFamilyRanks(): readonly FamilyRankDef[] {
  return FAMILY_RANKS;
}
