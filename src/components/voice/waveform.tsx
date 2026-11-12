import { cn } from "@/lib/utils";

const BAR_DELAYS = [0, 0.12, 0.24, 0.12, 0];

export function Waveform({
  className,
  barClassName,
  active = true,
}: {
  className?: string;
  barClassName?: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn("flex items-center gap-[3px]", className)}
      aria-hidden="true"
    >
      {BAR_DELAYS.map((delay, i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-brand-violet",
            active && "waveform-bar",
            barClassName
          )}
          style={{
            height: i === 2 ? "16px" : i === 1 || i === 3 ? "11px" : "7px",
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </div>
  );
}
