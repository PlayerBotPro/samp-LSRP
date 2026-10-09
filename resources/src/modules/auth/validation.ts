const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RP_NAME_RE = /^[A-Z][a-z]+_[A-Z][a-z]+$/;
const MIN_AGE = 16;
const MAX_AGE = 80;

export function isRoleplayName(name: string): boolean {
  return RP_NAME_RE.test(name) && name.length >= 5 && name.length <= 24;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailError(email: string): string | null {
  if (email.length < 6 || email.length > 255 || !EMAIL_RE.test(email)) {
    return "请输入有效的电子邮箱，例如 name@example.com";
  }

  return null;
}

export function passwordError(password: string): string | null {
  if (password.length < 6 || password.length > 32) {
    return "密码长度须为 6 至 32 个字符";
  }

  if (/\s/.test(password)) {
    return "密码不得包含空格";
  }

  return null;
}

export function parseBirthDate(raw: string): { iso: string } | { error: string } {
  const match = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return { error: "出生日期请使用 日.月.年 格式，例如 15.04.1998" };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { error: "该日期不存在" };
  }

  const age = ageOn(date, new Date());
  if (age < MIN_AGE) {
    return { error: `注册年龄须满 ${MIN_AGE} 岁` };
  }

  if (age > MAX_AGE) {
    return { error: "请检查出生日期" };
  }

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { iso };
}

export function formatBirthDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

export function ageFromBirthDate(iso: string, now = new Date()): number {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) {
    return 0;
  }

  return ageOn(new Date(year, month - 1, day), now);
}

function ageOn(birth: Date, now: Date): number {
  let age = now.getFullYear() - birth.getFullYear();
  const month = now.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age;
}
