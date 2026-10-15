-- When each person first reached each activation step (null = not yet). Ephemeral: never stored per person.
with members as (
  select m.user_id, t.trip_id, t.created_at, t.start_date, t.members, t.deleted_at
  from {{ ref('stg_trip_members') }} m
  join {{ ref('stg_trips') }} t using (trip_id)
)
select
  u.user_id,
  u.signup_day,
  date_trunc('week', u.created_at)::date as signup_week,
  (select min(t.created_at) from {{ ref('stg_trips') }} t where t.owner_id = u.user_id) as first_trip_at,
  (select min(i.created_at) from {{ ref('stg_items') }} i where i.added_by_id = u.user_id) as first_stop_at,
  (select min(m.created_at) from members m where m.user_id = u.user_id and m.members >= 2) as first_collab_at,
  (select min(m.start_date) from members m where m.user_id = u.user_id and m.deleted_at is null and m.start_date <= current_date) as first_trip_start,
  (select min(e.at) from {{ ref('stg_trip_events') }} e where e.actor_id = u.user_id and e.type = 'item.status') as first_mark_at,
  (select min(p.at) from (
     select at from {{ ref('stg_social') }} s where s.user_id = u.user_id and s.kind = 'post'
     union all
     select at from {{ ref('stg_product_events') }} pe where pe.user_id = u.user_id and pe.type = 'trip.published'
   ) p) as first_share_at
from {{ ref('stg_users') }} u
