import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export default class OrderItem extends Model {
  static table = 'order_items';

  static associations = {
    orders: { type: 'belongs_to' as const, key: 'order_id' },
    products: { type: 'belongs_to' as const, key: 'product_id' },
  };

  @text('order_id') orderId!: string;
  @text('product_id') productId!: string;
  @field('qty') qty!: number;
  @field('unit_price') unitPrice!: number;
  @text('notes') notes!: string | null;
  @text('status') status!: string;
  @field('is_complimentary') isComplimentary!: boolean;
  @text('comp_reason') compReason!: string | null;
  @text('comp_authorized_by') compAuthorizedBy!: string | null;
  @field('voided') voided!: boolean;
  @text('void_reason') voidReason!: string | null;
  @text('voided_by') voidedBy!: string | null;
  @relation('orders', 'order_id') order: any;
  @relation('products', 'product_id') product: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
