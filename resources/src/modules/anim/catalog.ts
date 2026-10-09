/** 动作目录（与 Advance RP / Funny RP 类似）。索引 0..73 对应 /anim 1..74。 */

export type SpecialAnim = {
  kind: "special";
  label: string;
  action: number;
};

export type LibraryAnim = {
  kind: "library";
  label: string;
  lib: string;
  name: string;
  delta: number;
  loop: boolean;
  lockX: boolean;
  lockY: boolean;
  freeze: boolean;
  time: number;
};

export type AnimEntry = SpecialAnim | LibraryAnim;

const SPECIAL_ACTION_DANCE1 = 5;
const SPECIAL_ACTION_DANCE2 = 6;
const SPECIAL_ACTION_DANCE3 = 7;
const SPECIAL_ACTION_DANCE4 = 8;

function special(label: string, action: number): SpecialAnim {
  return { kind: "special", label, action };
}

function anim(
  label: string,
  lib: string,
  name: string,
  loop: boolean,
  lockX = false,
  lockY = false,
  freeze = false,
  time = 0,
  delta = 4.1
): LibraryAnim {
  return { kind: "library", label, lib, name, delta, loop, lockX, lockY, freeze, time };
}

export const ANIMATIONS: readonly AnimEntry[] = [
  special("舞蹈 1", SPECIAL_ACTION_DANCE1),
  special("舞蹈 2", SPECIAL_ACTION_DANCE2),
  special("舞蹈 3", SPECIAL_ACTION_DANCE3),
  special("舞蹈 4", SPECIAL_ACTION_DANCE4),
  anim("舞蹈 5", "DANCING", "DAN_Left_A", true),
  anim("舞蹈 6", "DANCING", "dnce_M_a", true),
  anim("挥手", "ON_LOOKERS", "wave_loop", true),
  anim("躺在地上", "BEACH", "bather", true),
  anim("醉酒步态", "PED", "WALK_drunk", true, true, true),
  anim("翻滚", "PED", "Crouch_Roll_L", true, true, true),
  anim("告别", "PED", "endchat_03", true),
  anim("说唱", "BENCHPRESS", "gym_bp_celebrate", true),
  anim("躲藏", "PED", "cower", true),
  anim("放置炸弹", "BOMBER", "BOM_Plant", false),
  anim("戴上面具", "SHOP", "ROB_Shifty", false),
  anim("向前伸手", "SHOP", "ROB_Loop_Threat", true),
  anim("双手合十", "COP_AMBIENT", "Coplook_loop", true),
  anim("吃坏东西了……", "FOOD", "EAT_Vomit_P", false),
  anim("吃点东西", "FOOD", "EAT_Burger", false),
  anim("拍某人的屁股", "SWEET", "sweet_ass_slap", false),
  anim("兜售毒品", "DEALER", "DEALER_DEAL", false),
  anim("触电", "CRACK", "crckdeth2", true),
  anim("男性抽烟", "LOWRIDER", "M_smklean_loop", true),
  anim("女性抽烟", "LOWRIDER", "F_smklean_loop", true),
  anim("蹲下", "BEACH", "ParkSit_M_loop", true),
  anim("太极", "PARK", "Tai_Chi_Loop", true),
  anim("喝饮料", "BAR", "dnk_stndF_loop", true),
  anim("单腿舞蹈", "DANCING", "DAN_Right_A", true),
  anim("守门员姿势", "BSKTBALL", "BBALL_def_loop", true),
  anim("Facepalm", "MISC", "plyr_shkhead", false),
  anim("东方舞蹈动作", "BSKTBALL", "BBALL_idle", false),
  anim("招呼某人", "CAMERA", "camstnd_cmon", true),
  anim("举起双手！", "SHOP", "SHP_Rob_HandsUP", true),
  anim("侧睡", "CRACK", "crckidle2", true),
  anim("仰睡", "CRACK", "crckidle4", true),
  anim("四处张望", "DEALER", "DEALER_IDLE", true),
  anim("侧身倚靠", "GANGS", "leanIDLE", true),
  anim("侧身推撞", "GANGS", "shake_carSH", false),
  anim("沉思", "GANGS", "smkcig_prtl", false),
  anim("侧卧并用手支撑", "BEACH", "ParkSit_W_loop", true),
  anim("坐在椅子上", "INT_HOUSE", "LOU_Loop", true),
  anim("疲惫地坐在电脑前", "INT_OFFICE", "OFF_Sit_Bored_Loop", true),
  anim("坐在桌旁", "INT_OFFICE", "OFF_Sit_Idle_Loop", true),
  anim("坐着打字", "INT_OFFICE", "OFF_Sit_Type_Loop", true),
  anim("拿起东西仔细查看", "INT_SHOP", "shop_shelf", true),
  anim("跷着腿坐下", "JST_BUISNESS", "girl_02", true),
  anim("拒绝某事", "KISSING", "GF_StreetArgue_02", false),
  anim("亲吻 1", "KISSING", "Grlfrd_Kiss_01", false),
  anim("亲吻 2", "KISSING", "Grlfrd_Kiss_02", false),
  anim("亲吻 3", "KISSING", "Grlfrd_Kiss_03", false),
  anim("原地挥舞双手", "LOWRIDER", "RAP_B_Loop", true),
  anim("人工呼吸", "MEDIC", "CPR", true),
  anim("扇躺着的人耳光", "MISC", "bitchslap", true),
  anim("隔着东西偷看", "MISC", "bng_wndw", true),
  anim("斗牛士动作", "MISC", "KAT_Throw_K", false),
  anim("坐在椅子上（2）", "MISC", "SEAT_LR", true),
  anim("坐在椅子上（3）", "PED", "SEAT_idle", true),
  anim("向上看", "ON_LOOKERS", "lkup_loop", true),
  anim("用手指向上方", "ON_LOOKERS", "Pointup_loop", true),
  anim("惊恐", "ON_LOOKERS", "panic_loop", true),
  anim("大声呼喊", "ON_LOOKERS", "shout_02", true),
  anim("小便", "PAULNMAC", "Piss_loop", true),
  anim("帮派手势", "GHANDS", "gsign1LH", true),
  anim("在车站招手", "PED", "IDLE_taxi", true),
  anim("踢门", "POLICE", "Door_Kick", false),
  anim("敲门", "POLICE", "CopTraf_Stop", true),
  anim("发起暴乱", "RIOT", "RIOT_ANGRY_B", true),
  anim("跟着节奏摇摆", "LOWRIDER", "RAP_C_Loop", true),
  anim("躺在地上（2）", "SWAT", "gnstwall_injurd", true),
  anim("身体不适", "SWEET", "Sweet_injuredloop", true),
  anim("问候 1", "RIOT", "RIOT_ANGRY", true),
  anim("问候 2", "GHANDS", "gsign2", true),
  anim("问候 3", "GHANDS", "gsign4", true),
  anim("问候 4", "GHANDS", "gsign5", true),
];

export const ANIM_COUNT = ANIMATIONS.length;
export const ANIM_INFO_LABEL = "{33CC00}信息";

export function dialogAnimList(): string {
  const lines = ANIMATIONS.map((entry, index) => `${index + 1}. ${entry.label}`);
  lines.push(ANIM_INFO_LABEL);
  return lines.join("\n");
}
