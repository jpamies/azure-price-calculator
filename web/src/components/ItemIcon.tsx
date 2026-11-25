import { iconKeyForModule } from "@/catalog/icon-map";
import { ServiceIcon } from "@/components/ServiceIcon";
import type { Catalog } from "@/data/catalog";
import { serviceByName } from "@/data/catalog";
import type { Item } from "@/domain/model";

/** Service icon of an item: the module icon, or the chosen service's icon for generic items. */
export function ItemIcon({ item, catalog, size = 32, title, className }: { item: Item; catalog?: Catalog; size?: number; title?: string; className?: string }) {
  if (item.moduleId === "generic" && item.config.serviceName.trim()) {
    const family = catalog ? serviceByName(catalog, item.config.serviceName)?.serviceFamily : undefined;
    return <ServiceIcon serviceName={item.config.serviceName} serviceFamily={family} size={size} title={title} className={className} />;
  }
  return <ServiceIcon iconKey={iconKeyForModule(item.moduleId)} size={size} title={title} className={className} />;
}
