select id as user_id, created_at, created_at::date as signup_day, is_demo, deleted_at
from {{ source('app', 'users') }}
