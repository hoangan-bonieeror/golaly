select td.trip_id, d.id as destination_id, d.slug, d.name, d.country
from {{ source('app', 'trip_destinations') }} td
join {{ source('app', 'destinations') }} d on d.id = td.destination_id
