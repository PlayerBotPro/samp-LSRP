export type Licenses = {
  car: boolean;
  moto: boolean;
  fly: boolean;
  boat: boolean;
  gun: boolean;
};

export type LicenseKey = keyof Licenses;

export type LicenseDef = {
  key: LicenseKey;
  label: string;
  offer: string;
  min: number;
  max: number;
};

export const EMPTY_LICENSES: Licenses = {
  car: false,
  moto: false,
  fly: false,
  boat: false,
  gun: false,
};

export const LICENSE_ROWS: readonly LicenseDef[] = [
  { key: "car", label: "汽车", offer: "汽车", min: 5000, max: 50000 },
  { key: "moto", label: "摩托车", offer: "摩托车", min: 3000, max: 30000 },
  { key: "fly", label: "飞行器", offer: "飞行器", min: 20000, max: 150000 },
  { key: "boat", label: "船舶", offer: "船舶", min: 10000, max: 80000 },
  { key: "gun", label: "枪械", offer: "枪械", min: 15000, max: 100000 },
];

export function licenseFlag(value: unknown): boolean {
  return Boolean(Number(value));
}

export function missingLicenses(licenses: Licenses): LicenseDef[] {
  return LICENSE_ROWS.filter((row) => !licenses[row.key]);
}

export function findLicense(key: string): LicenseDef | null {
  return LICENSE_ROWS.find((row) => row.key === key) ?? null;
}
