import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CurrencySelect } from "@/components/estimate/CurrencySelect";
import { RegionSelect } from "@/components/estimate/RegionSelect";
import { THEME_OPTIONS } from "@/components/layout/ThemeMenu";
import { NarrowContainer } from "@/components/PageContainer";
import { BackupSection } from "@/components/settings/BackupSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { regionName } from "@/data/catalog";
import { useCatalog } from "@/data/hooks";
import { HOURS_PER_MONTH, MAX_HOURS_PER_MONTH } from "@/domain/model";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { STORAGE_KEY, flushSave, useSettings, useStore } from "@/store/useStore";

function Section({ title, description, children, danger }: { title: string; description?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <section className={danger ? "rounded-xl border border-destructive/30 bg-card shadow-sm" : "rounded-xl border bg-card shadow-sm"} aria-label={title}>
      <div className="border-b px-5 py-4">
        <h2 className={danger ? "font-heading text-base font-semibold text-destructive" : "font-heading text-base font-semibold"}>{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-6 px-5 py-5">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-start sm:gap-6">
      <div className="grid gap-1 sm:pt-1.5">
        <Label htmlFor={htmlFor}>{label}</Label>
      </div>
      <div className="grid min-w-0 gap-1.5">
        {children}
        {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function HoursInput({ value }: { value: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_HOURS_PER_MONTH;
  const commit = () => {
    if (valid && parsed !== value) {
      useStore.getState().updateSettings({ hoursPerMonth: parsed });
      toast.success(`New services will use ${parsed} hours per month`);
    } else if (!valid) setDraft(String(value));
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        id="settings-hours"
        type="number"
        inputMode="decimal"
        min={1}
        max={MAX_HOURS_PER_MONTH}
        step={1}
        value={draft}
        aria-invalid={!valid}
        aria-describedby="settings-hours-hint"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="w-28 tabular-nums"
      />
      <span className="text-sm text-muted-foreground">hours / month</span>
      {value !== HOURS_PER_MONTH && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            useStore.getState().updateSettings({ hoursPerMonth: HOURS_PER_MONTH });
            setDraft(String(HOURS_PER_MONTH));
          }}
        >
          Reset to {HOURS_PER_MONTH}
        </Button>
      )}
    </div>
  );
}

function storageUsage(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    const kb = (raw.length * 2) / 1024;
    return kb < 1 ? "less than 1 KB" : `${kb < 100 ? kb.toFixed(1) : Math.round(kb)} KB`;
  } catch {
    return "unknown";
  }
}

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const settings = useSettings();
  const estimateCount = useStore((s) => s.estimates.length);
  const { catalog, status } = useCatalog();
  const [clearOpen, setClearOpen] = useState(false);
  const update = (patch: Parameters<ReturnType<typeof useStore.getState>["updateSettings"]>[0]) => useStore.getState().updateSettings(patch);
  const lastRegion = settings.lastRegion && settings.lastRegion !== settings.defaultRegion ? settings.lastRegion : undefined;

  return (
    <NarrowContainer>
      <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Saved in this browser. They apply to new estimates and new services.</p>

      <div className="mt-8 grid gap-6">
        <Section title="Defaults" description="Starting values for new estimates and services; each estimate and service can override them.">
          <Field label="Currency" hint="Display currency of new estimates. USD is Microsoft's pricing currency; others are converted with the daily FX snapshot.">
            <CurrencySelect
              id="settings-currency"
              value={settings.defaultCurrency}
              fx={catalog?.fx}
              disabled={status !== "ready"}
              onChange={(defaultCurrency) => update({ defaultCurrency })}
            />
          </Field>
          <Field
            label="Region"
            hint={
              lastRegion ? (
                <>
                  New services currently use <strong className="font-medium text-foreground">{regionName(catalog, lastRegion)}</strong>, the region you picked
                  last.{" "}
                  <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => update({ lastRegion: undefined })}>
                    Use the default instead
                  </button>
                </>
              ) : (
                "Region of new services. After you change a service's region, new services follow your latest choice."
              )
            }
          >
            <RegionSelect
              value={settings.defaultRegion}
              valueName={regionName(catalog, settings.defaultRegion)}
              regions={catalog?.regions ?? []}
              allowed={null}
              disabled={!catalog}
              label="Default region"
              onChange={(defaultRegion) => update({ defaultRegion, lastRegion: undefined })}
              className="w-full sm:w-64"
            />
          </Field>
          <Field
            label="Hours per month"
            htmlFor="settings-hours"
            hint={
              <span id="settings-hours-hint">
                For new VMs, SQL Server licenses and hourly meters. {HOURS_PER_MONTH} = 24 h × 365 days ÷ 12 months (always on); maximum {MAX_HOURS_PER_MONTH}.
              </span>
            }
          >
            <HoursInput value={settings.hoursPerMonth} />
          </Field>
        </Section>

        <Section title="Appearance">
          <Field label="Theme">
            <ToggleGroup
              type="single"
              variant="outline"
              value={settings.theme}
              onValueChange={(v) => {
                if (v === "light" || v === "dark" || v === "system") update({ theme: v });
              }}
              aria-label="Theme"
            >
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <ToggleGroupItem key={value} value={value} className="gap-1.5 px-3">
                  <Icon aria-hidden="true" />
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </Section>

        <Section
          title="Backup and restore"
          description={
            <>
              Estimates live only in this browser ({estimateCount} {estimateCount === 1 ? "estimate" : "estimates"}, {storageUsage()}). Export a backup to keep them
              safe or move them to another device.
            </>
          }
        >
          <BackupSection />
        </Section>

        <Section title="Danger zone" danger>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Clear all data</p>
              <p className="text-sm text-muted-foreground">Deletes every estimate and resets the settings in this browser. This can't be undone.</p>
            </div>
            <Button variant="destructive" className="shrink-0" onClick={() => setClearOpen(true)}>
              <Trash2 />
              Clear all data
            </Button>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear all data?"
        description={
          <p>
            {estimateCount} {estimateCount === 1 ? "estimate" : "estimates"} and your settings will be permanently deleted from this browser. Export a backup first if
            you might need them.
          </p>
        }
        confirmLabel="Delete everything"
        destructive
        onConfirm={() => {
          useStore.getState().clearAll();
          flushSave();
          toast.success("All data cleared");
        }}
      />
    </NarrowContainer>
  );
}
