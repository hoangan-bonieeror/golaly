-- Trips created per day and destination (where people plan to go).
select
  t.created_at::date as day,
  d.destination_id, d.slug, d.name, d.country,
  count(distinct t.trip_id) as trips_created,
  now() as built_at
from {{ ref('stg_trips') }} t
join {{ ref('stg_trip_destinations') }} d using (trip_id)
where t.deleted_at is null and t.created_at >= current_date - {{ var('history_days') }}
group by 1, 2, 3, 4, 5
order by 1, 6 desc
