-- Activation by sign-up week: how many of each week's new people reached each step within 30 days.
with m as (select * from {{ ref('int_user_milestones') }} where signup_week >= current_date - 7 * 26),
within as (
  select signup_week, user_id,
    first_trip_at  < signup_day + 30 as created_trip,
    first_stop_at  < signup_day + 30 as planned_stop,
    first_collab_at < signup_day + 30 as collaborated,
    first_trip_start < signup_day + 30 as trip_started,
    first_mark_at  < signup_day + 30 as marked_stop,
    first_share_at < signup_day + 30 as shared
  from m
)
select
  signup_week,
  count(*) as cohort_size,
  count(*) filter (where created_trip) as created_trip,
  count(*) filter (where planned_stop) as planned_stop,
  count(*) filter (where collaborated) as collaborated,
  count(*) filter (where trip_started) as trip_started,
  count(*) filter (where marked_stop) as marked_stop,
  count(*) filter (where shared) as shared,
  -- The last 30 days' cohorts are still young: their numbers will grow.
  signup_week + 30 > current_date as maturing,
  now() as built_at
from within
group by signup_week
having count(*) >= {{ var('min_cohort') }}
order by 1
