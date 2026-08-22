import Image from "next/image";
import { cn } from "@/lib/utils";

const RATIO = 1200 / 541;

/**
 * Delta International wordmark.
 *
 * The supplied artwork is white, so it only reads on dark surfaces. A
 * slate-900 variant is generated alongside it for light mode. Both are
 * rendered and toggled with `dark:` classes rather than useTheme(), so the
 * correct one is present in the very first paint — swapping on a hook would
 * flash the wrong logo while the theme resolves on the client.
 */
export function Logo({ width = 150, className }: { width?: number; className?: string }) {
  const height = Math.round(width / RATIO);
  const shared = "h-auto w-full select-none";

  return (
    <span
      className={cn("relative inline-block", className)}
      style={{ width, height }}
    >
      <Image
        src="/logo-light.png"
        alt="Delta International"
        width={width}
        height={height}
        priority
        className={cn(shared, "block scale-[.6] dark:hidden")}
      />
      <Image
        src="/logo-dark.png"
        alt=""
        aria-hidden
        width={width}
        height={height}
        priority
        className={cn(shared, "hidden  scale-[.6]  dark:block")}
      />
    </span>
  );
}

/** Just the gradient mark — for tight spots like the avatar row or a tab icon. */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/icon.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      priority
      className={cn("select-none", className)}
    />
  );
}
