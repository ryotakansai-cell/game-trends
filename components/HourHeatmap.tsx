const ROWS = [1, 2, 3, 4, 5, 6, 0]; // 月曜始まり（getHourHeatmap の行は 0=日曜）
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 濃さの段階。多いほど明るい白（1色の明るさで量を表す）。
 *  紫はサイトの決まりで「現在地」と「hover」にしか使わないので、ここでは使わない */
const STEPS = [
  "bg-white/5",
  "bg-white/20",
  "bg-white/40",
  "bg-white/65",
  "bg-white/90",
];

/** よく配信する時間帯。曜日×時間のマス目で、その時間に配信していた回数の多さを濃さで出す */
export function HourHeatmap({
  grid,
  weeks,
}: {
  grid: number[][];
  weeks: number;
}) {
  const max = Math.max(1, ...grid.flat());
  const total = grid.flat().reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-white/10 p-4">
      <p className="text-sm text-gray-300">
        よく配信する時間帯
        <span className="ml-2 text-xs text-gray-500">
          直近{weeks}週・日本時間
        </span>
      </p>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[20rem] max-w-2xl">
          {ROWS.map((wd) => (
            <div key={wd} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-[11px] text-gray-500">
                {WEEKDAYS[wd]}
              </span>
              <div className="grid flex-1 grid-cols-24 gap-[2px] py-[1px]">
                {grid[wd].map((n, h) => {
                  const step =
                    n === 0 ? 0 : Math.ceil((n / max) * (STEPS.length - 1));
                  return (
                    <div
                      key={h}
                      title={`${WEEKDAYS[wd]}曜 ${h}時台：${n}回`}
                      className={`h-3.5 rounded-[2px] sm:h-4 ${STEPS[step]}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {/* 時刻の目盛りは 0・6・12・18 時だけ */}
          <div className="ml-[1.375rem] mt-1 grid grid-cols-4 text-[10px] text-gray-500">
            {[0, 6, 12, 18].map((h) => (
              <span key={h}>{h}時</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
