import { FilterPills } from "@/components/FilterPills";

export type GameTab =
  "overview" | "twitch" | "steam" | "roblox" | "appstore" | "ratio";

const TABS: { value: GameTab; label: string; href: string }[] = [
  // 各プラットフォームの上位5本を並べた入口。単位の違う数字（視聴者数・遊んでいる人数・売上の順位）は
  // 1つの順位に混ぜられないので、合算した順位ではなく並べるだけにしている
  { value: "overview", label: "総合", href: "/games" },
  { value: "twitch", label: "Twitch", href: "/games/twitch" },
  { value: "steam", label: "Steam", href: "/games/steam" },
  { value: "roblox", label: "Roblox", href: "/games/roblox" },
  { value: "appstore", label: "App Store", href: "/games/appstore" },
  // Steam の人数と Twitch の視聴者数を比べる。数字の意味の説明が要るので、Steam の一覧には混ぜず別にした
  { value: "ratio", label: "見られ度", href: "/games/ratio" },
];

/** ゲームのタブの切り替え。増えていく選択肢なので丸ボタン（折り返せる）にしている。
 *  以前は「Twitch（見られている）」のように説明を付けていたが、ボタンが長くなり邪魔だったので外した */
export function GameTabs({ current }: { current: GameTab }) {
  return (
    <FilterPills
      options={TABS.map((t) => ({
        label: t.label,
        href: t.href,
        active: t.value === current,
      }))}
    />
  );
}
