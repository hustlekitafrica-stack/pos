import { OrderItem as WDBOrderItem, Category as WDBCategory } from '@/lib/db/models';

interface RoutedItems {
  bar: WDBOrderItem[];
  kitchen: WDBOrderItem[];
}

/**
 * Split order items by their category's prep_station.
 * Returns two arrays: items for the bar printer and items for the kitchen printer.
 */
export function routeOrderItems(
  items: WDBOrderItem[],
  getCategoryForProduct: (productId: string) => WDBCategory | null
): RoutedItems {
  const routed: RoutedItems = { bar: [], kitchen: [] };

  for (const item of items) {
    if (item.voided) continue;

    const category = getCategoryForProduct(item.productId);
    if (!category) {
      // Default to bar if category not found
      routed.bar.push(item);
      continue;
    }

    if (category.prepStation === 'kitchen') {
      routed.kitchen.push(item);
    } else {
      routed.bar.push(item);
    }
  }

  return routed;
}
