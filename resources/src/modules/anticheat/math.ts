export function dist3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 根据 SA-MP 速度向量计算约略的“公里/小时”速度。 */
export function speedFromVelocity(vx: number, vy: number, vz: number): number {
  return Math.round(Math.hypot(vx, vy, vz) * 179.28625);
}

export function nowMs(): number {
  return Date.now();
}
