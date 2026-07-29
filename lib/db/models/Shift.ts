import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation, children } from '@nozbe/watermelondb/decorators';

export default class Shift extends Model {
  static table = 'shifts';

  static associations = {
    staff: { type: 'belongs_to' as const, key: 'staff_id' },
    orders: { type: 'has_many' as const, foreignKey: 'shift_id' },
  };

  @text('staff_id') staffId!: string;
  @date('opened_at') openedAt!: Date;
  @date('closed_at') closedAt!: Date | null;
  @field('opening_cash') openingCash!: number;
  @field('closing_cash_expected') closingCashExpected!: number | null;
  @field('closing_cash_actual') closingCashActual!: number | null;
  @field('variance') variance!: number | null;
  @relation('staff', 'staff_id') staffMember: any;
  @children('orders') orders: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
