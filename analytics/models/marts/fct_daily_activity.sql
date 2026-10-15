-- One row per UTC day: growth, engagement and collaboration counts, with rolling active users.
{% set days = var('history_days') %}
with spine as (
  select generate_series(current_date - {{ days - 1 }}, current_date, interval '1 day')::date as day
),
activity as (select * from {{ ref('int_activity') }} where day > current_date - {{ days + 28 }}),
rolling as (
  select s.day,
    count(distinct a.user_id) filter (where a.day = s.day) as dau,
    count(distinct a.user_id) filter (where a.day > s.day - 7) as wau,
    count(distinct a.user_id) as mau
  from spine s
  left join activity a on a.day > s.day - 28 and a.day <= s.day
  group by s.day
),
signups as (
  select signup_day as day, count(*) as signups from {{ ref('stg_users') }} group by 1
),
events as (
  select at::date as day,
    count(*) filter (where type = 'user.login') as logins,
    count(*) filter (where type = 'trip.forked') as trips_forked,
    count(*) filter (where type = 'trip.published') as trips_published,
    count(*) filter (where type = 'invite.accepted') as invites_accepted,
    count(*) filter (where type = 'post.created') as posts_created
  from {{ ref('stg_product_events') }} group by 1
),
trips as (
  select created_at::date as day, count(*) as trips_created, count(*) filter (where members >= 2) as trips_together
  from {{ ref('stg_trips') }} group by 1
),
started as (
  select start_date as day, count(*) as trips_started from {{ ref('stg_trips') }} where deleted_at is null and start_date is not null group by 1
),
plan as (
  select at::date as day,
    count(*) filter (where type = 'item.added') as stops_added,
    count(*) filter (where type = 'item.status') as stops_marked
  from {{ ref('stg_trip_events') }} group by 1
)
select
  r.day,
  coalesce(s.signups, 0) as signups,
  r.dau, r.wau, r.mau,
  coalesce(e.logins, 0) as logins,
  coalesce(t.trips_created, 0) as trips_created,
  coalesce(t.trips_together, 0) as trips_together,
  coalesce(e.trips_forked, 0) as trips_forked,
  coalesce(e.trips_published, 0) as trips_published,
  coalesce(st.trips_started, 0) as trips_started,
  coalesce(e.invites_accepted, 0) as invites_accepted,
  coalesce(e.posts_created, 0) as posts_created,
  coalesce(p.stops_added, 0) as stops_added,
  coalesce(p.stops_marked, 0) as stops_marked,
  now() as built_at
from rolling r
left join signups s using (day)
left join events e using (day)
left join trips t using (day)
left join started st using (day)
left join plan p using (day)
order by r.day
