import { FilterPills } from "@/components/FilterPills";
import { PlatformIcon } from "@/components/PlatformIcons";
import { PLATFORM_IDS, PLATFORMS, type PlatformId } from "@/lib/platforms";

/** 配信元の絞り込み（すべて / Twitch / YouTube / …）。トップと急上昇で共通。
 *  ボタンは台帳（lib/platforms.ts）の順に並ぶので、配信元を足してもここは直さなくてよい */
export function PlatformFilter({
  selected,
  hrefFor,
}: {
  selected: PlatformId | "all";
  /** 選んだときのリンク先（地域などほかの選択は呼び出し側で残す） */
  hrefFor: (platform: PlatformId | "all") => string;
}) {
  return (
    <FilterPills
      options={[
        { label: "すべて", href: hrefFor("all"), active: selected === "all" },
        ...PLATFORM_IDS.map((p) => ({
          label: PLATFORMS[p].label,
          icon: <PlatformIcon platform={p} />,
          href: hrefFor(p),
          active: selected === p,
        })),
      ]}
    />
  );
}
