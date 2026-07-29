import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export default class StockAdjustment extends Model {
  static table = 'stock_adjustments';

  static associations = {
    products: { type: 'belongs_to' as const, key: 'product_id' },
  };

  @text('product_id') productId!: string;
  @text('adjusted_by') adjustedBy!: string;
  @field('change_qty') changeQty!: number;
  @text('reason') reason!: string;
  @relation('products', 'product_id') product: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
