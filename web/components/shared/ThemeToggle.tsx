"use client";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const icons = {
  light:  <Sun  className="h-4 w-4" />,
  dark:   <Moon className="h-4 w-4" />,
  system: <Monitor className="h-4 w-4" />,
};

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const currentIcon = resolvedTheme === "dark" ? icons.dark : icons.light;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 relative"
          aria-label="Toggle theme"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={resolvedTheme}
              initial={{ opacity: 0, rotate: -30, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0,   scale: 1   }}
              exit={{    opacity: 0, rotate:  30, scale: 0.7 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {currentIcon}
            </motion.span>
          </AnimatePresence>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-36">
        {(["light", "dark", "system"] as const).map((t) => (
          <DropdownMenuItem
            key={t}
            onClick={() => setTheme(t)}
            className={`gap-2 cursor-pointer capitalize ${theme === t ? "font-semibold text-primary" : ""}`}
          >
            {icons[t]}
            {t === "system" ? "System" : t.charAt(0).toUpperCase() + t.slice(1)}
            {theme === t && (
              <motion.span
                layoutId="theme-check"
                className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
              />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
