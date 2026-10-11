import { SegmentedTabs } from "@/components/SegmentedTabs";

export type View = "card" | "list";

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  "aria-hidden": true,
};

/** カード表示とリスト表示の切り替え。地域の切り替えより重要度が低いので、文字ではなくアイコンにして目立たせない
 *  （マウスを乗せると「カード」「リスト」と出る） */
export function ViewToggle({
  view,
  hrefFor,
}: {
  view: View;
  hrefFor: (view: View) => string;
}) {
  return (
    <SegmentedTabs
      options={[
        {
          label: "カード",
          href: hrefFor("card"),
          active: view === "card",
          icon: (
            <svg {...iconProps}>
              <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
              <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
              <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
              <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
            </svg>
          ),
        },
        {
          label: "リスト",
          href: hrefFor("list"),
          active: view === "list",
          icon: (
            <svg {...iconProps}>
              <path d="M8 6h13M8 12h13M8 18h13" />
              <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth={3} />
            </svg>
          ),
        },
      ]}
    />
  );
}
