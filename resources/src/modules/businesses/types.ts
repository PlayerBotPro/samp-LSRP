/** Типы бизнесов (TINYINT type_id в БД, не MySQL ENUM). */
export const BusinessType = {
  SHOP_247: 1,
  AMMU: 2,
  CAR_ELITE: 3,
  CAR_ECONOMY: 4,
  MOTO: 5,
  GAS: 6,
  FASTFOOD: 7,
  GYM: 8,
  CLOTHES: 9,
  BAR: 10,
  CLUB: 11,
  WORKSHOP: 12,
  STREET_FOOD: 13,
  VEHICLE_RENT: 14,
  CASINO: 15,
} as const;

export type BusinessTypeId = (typeof BusinessType)[keyof typeof BusinessType];

/** MapIcon ID по типу бизнеса. */
const MAP_ICON_BY_TYPE: Readonly<Record<number, number>> = {
  [BusinessType.SHOP_247]: 52,
  [BusinessType.AMMU]: 18,
  [BusinessType.CAR_ELITE]: 55,
  [BusinessType.CAR_ECONOMY]: 55,
  [BusinessType.MOTO]: 55,
  [BusinessType.GAS]: 47,
  [BusinessType.FASTFOOD]: 29,
  [BusinessType.GYM]: 54,
  [BusinessType.CLOTHES]: 45,
  [BusinessType.BAR]: 49,
  [BusinessType.CLUB]: 48,
  [BusinessType.WORKSHOP]: 27,
  [BusinessType.STREET_FOOD]: 17,
  [BusinessType.VEHICLE_RENT]: 55,
  [BusinessType.CASINO]: 44,
};

export function businessMapIconType(typeId: number): number {
  return MAP_ICON_BY_TYPE[typeId] ?? 52;
}

export function isGasStationType(typeId: number): boolean {
  return typeId === BusinessType.GAS;
}

export function isStreetFoodType(typeId: number): boolean {
  return typeId === BusinessType.STREET_FOOD;
}

export function isFastfoodType(typeId: number): boolean {
  return typeId === BusinessType.FASTFOOD;
}

export function isAmmuType(typeId: number): boolean {
  return typeId === BusinessType.AMMU;
}

export function isShop247Type(typeId: number): boolean {
  return typeId === BusinessType.SHOP_247;
}

export function isClothesType(typeId: number): boolean {
  return typeId === BusinessType.CLOTHES;
}

export function isWorkshopType(typeId: number): boolean {
  return typeId === BusinessType.WORKSHOP;
}

const TYPE_LABEL: Readonly<Record<number, string>> = {
  [BusinessType.SHOP_247]: "24/7",
  [BusinessType.AMMU]: "武器店",
  [BusinessType.CAR_ELITE]: "豪华汽车经销店",
  [BusinessType.CAR_ECONOMY]: "经济型汽车经销店",
  [BusinessType.MOTO]: "摩托车市场",
  [BusinessType.GAS]: "加油站",
  [BusinessType.FASTFOOD]: "快餐店",
  [BusinessType.GYM]: "健身房",
  [BusinessType.CLOTHES]: "服装店",
  [BusinessType.BAR]: "酒吧",
  [BusinessType.CLUB]: "俱乐部",
  [BusinessType.WORKSHOP]: "汽车修理厂",
  [BusinessType.STREET_FOOD]: "街头小吃摊",
  [BusinessType.VEHICLE_RENT]: "车辆租赁",
  [BusinessType.CASINO]: "赌场",
};

export function businessTypeLabel(typeId: number): string {
  return TYPE_LABEL[typeId] ?? `类型 ${typeId}`;
}
