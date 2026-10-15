select id as event_id, type, user_id, trip_id, props, at
from {{ source('app', 'product_events') }}
