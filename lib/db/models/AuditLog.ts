import { Model } from '@nozbe/watermelondb';
import { text, readonly, date } from '@nozbe/watermelondb/decorators';

export default class AuditLog extends Model {
  static table = 'audit_log';

  @text('action') action!: string;
  @text('entity_type') entityType!: string;
  @text('entity_id') entityId!: string;
  @text('staff_id') staffId!: string;
  @text('device_id') deviceId!: string;
  @text('details') details!: string;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
