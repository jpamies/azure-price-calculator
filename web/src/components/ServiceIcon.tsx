import { useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  Activity,
  ArrowLeftRight,
  Brain,
  ChartColumn,
  Cloud,
  CodeXml,
  Container,
  Cpu,
  Database,
  FingerprintPattern,
  Glasses,
  Globe,
  HardDrive,
  KeyRound,
  Lock,
  MessagesSquare,
  Monitor,
  Network,
  Puzzle,
  RefreshCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

import {
  fallbackStyleFor,
  iconKeyForService,
  isIconKey,
  type IconKey,
  type LucideIconName,
} from "@/catalog/icon-map";
import { cn } from "@/lib/utils";

const GLYPHS: Record<LucideIconName, LucideIcon> = {
  Activity,
  ArrowLeftRight,
  Brain,
  ChartColumn,
  Cloud,
  CodeXml,
  Container,
  Cpu,
  Database,
  FingerprintPattern,
  Glasses,
  Globe,
  HardDrive,
  KeyRound,
  Lock,
  MessagesSquare,
  Monitor,
  Network,
  Puzzle,
  RefreshCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  Workflow,
  Zap,
};

const ICON_DIR = `${import.meta.env.BASE_URL}icons/azure/`;

// index.json (written by scripts/sync_icons.py) is fetched once and shared by every ServiceIcon.
// A missing or unreadable index means "no official icons": everything renders as fallback tiles.
let availableIcons: ReadonlySet<IconKey> | null = null;
let indexRequest: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function fetchIconIndex(): Promise<ReadonlySet<IconKey>> {
  try {
    const response = await fetch(`${ICON_DIR}index.json`);
    if (!response.ok) return new Set<IconKey>();
    const data: unknown = await response.json();
    const icons = typeof data === "object" && data !== null ? (data as { icons?: unknown }).icons : null;
    if (typeof icons !== "object" || icons === null) return new Set<IconKey>();
    return new Set(Object.keys(icons).filter(isIconKey));
  } catch {
    return new Set<IconKey>();
  }
}

function loadIconIndex(): void {
  indexRequest ??= fetchIconIndex().then((keys) => {
    availableIcons = keys;
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  loadIconIndex();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlySet<IconKey> | null {
  return availableIcons;
}

export interface ServiceIconProps {
  /** Explicit icon key; wins over serviceName/serviceFamily. */
  iconKey?: IconKey;
  /** Retail Prices API serviceName (e.g. "Virtual Machines"). */
  serviceName?: string | null;
  /** Retail Prices API serviceFamily (e.g. "Compute"), used when the name is not recognised. */
  serviceFamily?: string | null;
  /** Width and height in px. */
  size?: number;
  className?: string;
  /** Accessible name and tooltip. Without it the icon is decorative (hidden from assistive tech). */
  title?: string;
}

/**
 * Official Azure Architecture Icon for a service (copied unchanged by scripts/sync_icons.py) or,
 * when it is not available, a tile with a lucide glyph. Always occupies exactly size x size px.
 */
export function ServiceIcon({ iconKey, serviceName, serviceFamily, size = 32, className, title }: ServiceIconProps) {
  const key = iconKey ?? iconKeyForService(serviceName, serviceFamily);
  const available = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [failedKey, setFailedKey] = useState<IconKey | null>(null);

  const box: CSSProperties = { width: size, height: size };
  const label = title ? { role: "img", "aria-label": title, title } : { "aria-hidden": true };

  if (available === null) {
    return <span className={cn("inline-block shrink-0 rounded-[22%] bg-muted", className)} style={box} {...label} />;
  }

  if (available.has(key) && failedKey !== key) {
    return (
      <img
        src={`${ICON_DIR}${key}.svg`}
        alt={title ?? ""}
        title={title}
        aria-hidden={title ? undefined : true}
        width={size}
        height={size}
        draggable={false}
        loading="lazy"
        decoding="async"
        className={cn("inline-block shrink-0 select-none object-contain", className)}
        style={box}
        onError={() => setFailedKey(key)}
      />
    );
  }

  const { icon, tile } = fallbackStyleFor(key);
  const Glyph = GLYPHS[icon];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-[22%] text-white shadow-sm ring-1 ring-white/15 ring-inset dark:ring-white/10",
        tile,
        className,
      )}
      style={box}
      {...label}
    >
      <Glyph aria-hidden="true" focusable="false" size={Math.round(size * 0.58)} strokeWidth={size < 24 ? 2.25 : 2} />
    </span>
  );
}

export default ServiceIcon;
