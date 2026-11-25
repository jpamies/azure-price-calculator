import { Info, LayoutList, Menu, Settings } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark } from "@/components/layout/BrandMark";
import { PricesChip } from "@/components/layout/PricesChip";
import { THEME_OPTIONS, ThemeMenu } from "@/components/layout/ThemeMenu";
import { cn } from "@/lib/utils";
import { useSettings, useStore } from "@/store/useStore";

const NAV = [
  { to: "/", label: "Estimates", icon: LayoutList },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/about", label: "About", icon: Info },
] as const;

/** "Estimates" stays active inside the editor (#/estimate/:id). */
function useIsActive() {
  const { pathname } = useLocation();
  return (to: string) => (to === "/" ? pathname === "/" || pathname.startsWith("/estimate/") : pathname === to);
}

export function TopBar() {
  const isActive = useIsActive();
  const theme = useSettings().theme;
  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Azure Price Calculator (unofficial) — estimates"
        >
          <BrandMark size={30} className="max-[399px]:size-7!" />
          <span className="truncate font-heading text-[15px] font-semibold tracking-tight max-[399px]:text-sm sm:text-base">Azure Price Calculator</span>
          <Badge
            variant="outline"
            className="hidden h-5 rounded-md border-control-border/60 px-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase min-[420px]:inline-flex"
          >
            Unofficial
          </Badge>
        </Link>

        <nav aria-label="Main" className="ml-3 hidden items-center gap-0.5 md:flex">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              aria-current={isActive(to) ? "page" : undefined}
              className={cn(
                "relative inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isActive(to) &&
                  "text-foreground after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-primary",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <PricesChip />
          <ThemeMenu className="hidden md:inline-flex" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu">
                <Menu />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {NAV.map(({ to, label, icon: Icon }) => (
                <DropdownMenuItem key={to} asChild className={cn(isActive(to) && "font-semibold text-primary")}>
                  <Link to={to} aria-current={isActive(to) ? "page" : undefined}>
                    <Icon aria-hidden="true" />
                    {label}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (value === "light" || value === "dark" || value === "system") useStore.getState().updateSettings({ theme: value });
                }}
              >
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon aria-hidden="true" />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
