select
  id as trip_id, owner_id, created_at, start_date, end_date, visibility,
  forked_from_id is not null as is_fork, deleted_at,
  (select count(*) from {{ source('app', 'trip_members') }} m where m.trip_id = t.id) as members
from {{ source('app', 'trips') }} t
