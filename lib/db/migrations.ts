import { schemaMigrations, addColumns, createTable } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'shifts',
          columns: [
            { name: 'status', type: 'string' },
            { name: 'approved_by', type: 'string', isOptional: true },
            { name: 'approved_at', type: 'number', isOptional: true },
            { name: 'closure_notes', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'settings',
          columns: [
            { name: 'alert_email', type: 'string' },
            { name: 'logo_url', type: 'string', isOptional: true },
            { name: 'bar_printer_address', type: 'string', isOptional: true },
            { name: 'kitchen_printer_address', type: 'string', isOptional: true },
            { name: 'venue_name', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: 'settings',
          columns: [
            { name: 'venue_phone',   type: 'string', isOptional: true },
            { name: 'venue_address', type: 'string', isOptional: true },
            { name: 'mpesa_paybill', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'settings',
          columns: [
            { name: 'printer_address', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
  ],
});
