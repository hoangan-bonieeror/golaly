select trip_id, user_id, role, joined_at
from {{ source('app', 'trip_members') }}
