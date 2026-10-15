select id as item_id, trip_id, added_by as added_by_id, status, created_at
from {{ source('app', 'itinerary_items') }}
