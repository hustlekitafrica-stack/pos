import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export default class Product extends Model {
  static table = 'products';

  static associations = {
    categories: { type: 'belongs_to' as const, key: 'category_id' },
  };

  @text('name') name!: string;
  @text('category_id') categoryId!: string;
  @field('price') price!: number;
  @field('cost_price') costPrice!: number;
  @field('stock_qty') stockQty!: number;
  @text('unit') unit!: string;
  @field('low_stock_threshold') lowStockThreshold!: number;
  @field('low_stock_alert_sent') lowStockAlertSent!: boolean;
  @field('is_out_of_stock') isOutOfStock!: boolean;
  @field('is_active') isActive!: boolean;
  @relation('categories', 'category_id') category: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
