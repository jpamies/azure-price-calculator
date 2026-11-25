// Module configuration forms keyed by module id. The item card renders
// `configComponents[item.moduleId]` (or <ModuleConfig {...props} />) with ModuleConfigProps.
import type { ModuleId } from "@/domain/model";
import { AsrConfig } from "./AsrConfig";
import { BackupConfig } from "./BackupConfig";
import { DisksConfig } from "./DisksConfig";
import { GenericConfig } from "./GenericConfig";
import { SqlLicenseConfig } from "./SqlLicenseConfig";
import type { ConfigRegistry, ModuleConfigComponent, ModuleConfigProps } from "./types";
import { VmConfig } from "./VmConfig";

export const configComponents: ConfigRegistry = {
  vm: VmConfig,
  disks: DisksConfig,
  backup: BackupConfig,
  asr: AsrConfig,
  sqlLicense: SqlLicenseConfig,
  generic: GenericConfig,
};

/** Renders the form of any item (no union-typing gymnastics at the call site). */
export function ModuleConfig(props: ModuleConfigProps) {
  const Component = configComponents[props.item.moduleId] as unknown as ModuleConfigComponent<ModuleId>;
  return <Component {...props} />;
}
