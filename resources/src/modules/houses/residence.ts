import { findOwnedHouse } from "./repository";

export function residenceLabel(userId: number): string {
  const house = findOwnedHouse(userId);
  if (!house) {
    return "无家可归";
  }

  return `房屋（编号 ${house.id}）`;
}
