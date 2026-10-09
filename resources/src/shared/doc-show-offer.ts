import { omp, type Player } from "@omp-node/core";
import { Color } from "./colors";
import { WHISPER_RADIUS, arePlayersNearby } from "./nearby";
import { isPlayerActive, playerId, playerName } from "./player";
import { getAccount } from "../modules/auth/session";
import { claimYnOffer, getYnOfferKind, releaseYnOffer, type YnOfferKind } from "./yn-offer";

export type DocShowKind = "pass" | "lic" | "show_medcard" | "vbilet";

const KEY_YES = 65536;
const KEY_NO = 131072;
const OFFER_TTL_MS = 60_000;

const DOC_LABEL: Record<DocShowKind, string> = {
  pass: "护照",
  lic: "许可证",
  show_medcard: "医疗卡",
  vbilet: "军人证",
};

type DocShowOffer = {
  kind: DocShowKind;
  fromSlot: number;
  fromUserId: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

type ShowHandler = (viewer: Player, owner: Player) => void;

const pendingByTarget = new Map<number, DocShowOffer>();
const handlers = new Map<DocShowKind, ShowHandler>();
let bound = false;

/** 注册玩家按 Y 接受后展示证件的处理函数。 */
export function registerDocShowHandler(kind: DocShowKind, handler: ShowHandler): void {
  handlers.set(kind, handler);
  ensureBound();
}

/**
 * 提议展示证件。如果目标已有请求或玩家槽位无效，则返回 false。
 * 调用方负责检查距离和身份验证状态。
 */
export function offerDocShow(
  from: Player,
  to: Player,
  kind: DocShowKind,
  fromUserId: number
): boolean {
  const targetSlot = playerId(to);
  const fromSlot = playerId(from);
  if (targetSlot === null || fromSlot === null) {
    return false;
  }

  if (!claimYnOffer(targetSlot, kind as YnOfferKind)) {
    from.sendClientMessage(Color.error, "该玩家已有待处理的请求。");
    return false;
  }

  const label = DOC_LABEL[kind];
  const timer = setTimeout(() => {
    expireOffer(targetSlot);
  }, OFFER_TTL_MS);

  pendingByTarget.set(targetSlot, {
    kind,
    fromSlot,
    fromUserId,
    expiresAt: Date.now() + OFFER_TTL_MS,
    timer,
  });

  from.sendClientMessage(
    Color.gray,
    `你提议向 ${playerName(to)} 出示${label}。`
  );
  to.sendClientMessage(
    Color.white,
    `${playerName(from)} 提议向你出示${label}。`
  );
  to.sendClientMessage(
    Color.white,
    "按 {00CC00}Y {FFFFFF}查看，或按 {FF6600}N {FFFFFF}拒绝"
  );
  return true;
}

function ensureBound(): void {
  if (bound) {
    return;
  }
  bound = true;

  omp.on("playerKeyStateChange", (player, newKeys, oldKeys) => {
    const pressed = Number(newKeys) & ~Number(oldKeys);
    if ((pressed & KEY_YES) === 0 && (pressed & KEY_NO) === 0) {
      return;
    }

    const slot = playerId(player);
    if (slot === null) {
      return;
    }

    const kind = getYnOfferKind(slot);
    if (
      kind !== "pass" &&
      kind !== "lic" &&
      kind !== "show_medcard" &&
      kind !== "vbilet"
    ) {
      return;
    }

    const offer = pendingByTarget.get(slot);
    if (!offer) {
      releaseYnOffer(slot, kind);
      return;
    }

    if (Date.now() > offer.expiresAt) {
      expireOffer(slot);
      return;
    }

    if ((pressed & KEY_NO) !== 0) {
      refuseOffer(player, slot, offer);
      return;
    }

    if ((pressed & KEY_YES) !== 0) {
      acceptOffer(player, slot, offer);
    }
  });

  omp.on("playerDisconnect", (player) => {
    const slot = playerId(player);
    if (slot === null) {
      return;
    }

    if (pendingByTarget.has(slot)) {
      clearOffer(slot);
    }

    for (const [targetSlot, offer] of pendingByTarget) {
      if (offer.fromSlot === slot) {
        clearOffer(targetSlot);
        const target = omp.players.at(targetSlot);
        if (target && isPlayerActive(target)) {
          target.sendClientMessage(Color.error, "证件展示请求已取消。");
        }
      }
    }
  });
}

function acceptOffer(viewer: Player, targetSlot: number, offer: DocShowOffer): void {
  clearOffer(targetSlot);

  const owner = omp.players.at(offer.fromSlot);
  if (!owner || !isPlayerActive(owner)) {
    viewer.sendClientMessage(Color.error, "玩家已不在线。");
    return;
  }

  if (getAccount(owner)?.id !== offer.fromUserId) {
    viewer.sendClientMessage(Color.error, "证件展示请求已失效。");
    return;
  }

  if (!arePlayersNearby(viewer, owner, WHISPER_RADIUS)) {
    viewer.sendClientMessage(Color.error, "玩家距离太远。");
    owner.sendClientMessage(
      Color.error,
      `${playerName(viewer)} 无法查看：距离太远。`
    );
    return;
  }

  const handler = handlers.get(offer.kind);
  if (!handler) {
    return;
  }

  handler(viewer, owner);
}

function refuseOffer(viewer: Player, targetSlot: number, offer: DocShowOffer): void {
  clearOffer(targetSlot);
  viewer.sendClientMessage(Color.info, "你拒绝了查看。");

  const owner = omp.players.at(offer.fromSlot);
  if (owner && isPlayerActive(owner) && getAccount(owner)?.id === offer.fromUserId) {
    owner.sendClientMessage(
      Color.info,
      `${playerName(viewer)} 拒绝查看${DOC_LABEL[offer.kind]}。`
    );
  }
}

function expireOffer(targetSlot: number): void {
  const offer = pendingByTarget.get(targetSlot);
  if (!offer) {
    return;
  }

  clearOffer(targetSlot);

  const target = omp.players.at(targetSlot);
  if (target && isPlayerActive(target)) {
    target.sendClientMessage(Color.error, "证件展示请求已过期。");
  }

  const owner = omp.players.at(offer.fromSlot);
  if (owner && isPlayerActive(owner) && getAccount(owner)?.id === offer.fromUserId) {
    owner.sendClientMessage(Color.error, "证件展示请求已过期。");
  }
}

function clearOffer(targetSlot: number): void {
  const offer = pendingByTarget.get(targetSlot);
  if (!offer) {
    releaseYnOffer(targetSlot);
    return;
  }

  clearTimeout(offer.timer);
  pendingByTarget.delete(targetSlot);
  releaseYnOffer(targetSlot, offer.kind);
}
