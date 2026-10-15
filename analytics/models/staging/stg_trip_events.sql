select id as event_id, trip_id, actor_id, type, at
from {{ source('app', 'trip_events') }}
