import { FilterPills } from "@/components/FilterPills";

/** ゲームのタブの切り替え（Twitch で見られている / Steam で遊ばれている）。
 *  Roblox などを足すときは、ここに1行足す（増えていく選択肢なので丸ボタンにしている） */
export function GameTabs({ current }: { current: "twitch" | "steam" }) {
  return (
    <FilterPills
      options={[
        {
          label: "Twitch（見られている）",
          href: "/games",
          active: current === "twitch",
        },
        {
          label: "Steam（遊ばれている）",
          href: "/games/steam",
          active: current === "steam",
        },
      ]}
    />
  );
}
