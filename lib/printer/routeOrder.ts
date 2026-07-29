import { OrderItem, Category, PrepStation } from '@/types';

interface RoutedItems {
  bar: OrderItem[];
  kitchen: OrderItem[];
}

/**
 * Split order items by their category's prep_station.
 * Returns two arrays: items for the bar printer and items for the kitchen printer.
 */
export function routeOrderItems(
  items: OrderItem[],
  getCategoryForProduct: (productId: string) => Category | null
): RoutedItems {
  const routed: RoutedItems = { bar: [], kitchen: [] };

  for (const item of items) {
    if (item.voided) continue;

    const category = getCategoryForProduct(item.product_id);
    if (!category) {
      // Default to bar if category not found
      routed.bar.push(item);
      continue;
    }

    if (category.prep_station === 'kitchen') {
      routed.kitchen.push(item);
    } else {
      routed.bar.push(item);
    }
  }

  return routed;
}
