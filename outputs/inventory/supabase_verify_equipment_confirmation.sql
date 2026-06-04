select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_logs'
  and column_name in (
    'equipment_checked',
    'equipment_checked_by',
    'equipment_checked_at'
  )
order by column_name;
