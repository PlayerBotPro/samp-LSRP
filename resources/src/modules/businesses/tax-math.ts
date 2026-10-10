import {
  computePaidUntil,
  formatRentDate,
  currentDateLocal,
  rentDaysRemaining,
  rentDaysLeftLabel,
} from "../houses/rent-math";

/** 每日按企业价格计算的比例(0.1%),与住宅相同. */
export const BUSINESS_TAX_RATE = 0.001;

export function dailyBusinessTax(price: number): number {
  return Math.max(1, Math.floor(price * BUSINESS_TAX_RATE));
}

export function taxAmountForDays(price: number, days: number): number {
  return dailyBusinessTax(price) * days;
}

export {
  computePaidUntil,
  formatRentDate,
  currentDateLocal,
  rentDaysRemaining,
  rentDaysLeftLabel,
};
