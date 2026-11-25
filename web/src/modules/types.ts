// Contract between the item card (components/ItemCard) and the per-module configuration UIs.
import type { ComponentType } from "react";
import type { Catalog } from "@/data/catalog";
import type { ShardsState } from "@/data/hooks";
import type { ItemOf, ModuleId, Settings } from "@/domain/model";
import type { ItemResult } from "@/domain/types";
import type { MoneyFormatter } from "@/lib/format";

export interface ModuleConfigProps<M extends ModuleId = ModuleId> {
  item: ItemOf<M>;
  /** Partial config change; the store shallow-merges and validates it (invalid values are ignored). */
  onChange: (patch: Partial<ItemOf<M>["config"]>) => void;
  catalog: Catalog;
  /**
   * Rows for getModule(item.moduleId).shards(item.config, item.region, catalog.services),
   * keyed by refKey(ref). Already loaded by the card; status tells loading/error.
   */
  shards: ShardsState;
  /** Latest computed result for this item (undefined while prices load). */
  result?: ItemResult;
  /** Display-currency formatter (converts USD with the FX snapshot). */
  money: MoneyFormatter;
  /** Human name of item.region, e.g. "West Europe". */
  regionName: string;
  settings: Settings;
}

export type ModuleConfigComponent<M extends ModuleId = ModuleId> = ComponentType<ModuleConfigProps<M>>;

export type ConfigRegistry = { [M in ModuleId]: ModuleConfigComponent<M> };
