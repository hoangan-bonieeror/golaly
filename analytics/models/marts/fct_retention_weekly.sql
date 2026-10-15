-- Weekly retention by sign-up week: of the people who joined in a week, how many were active N weeks later.
-- Cohorts under var('min_cohort') people are left out.
with users as (
  select user_id, date_trunc('week', created_at)::date as cohort_week from {{ ref('stg_users') }}
  where created_at >= current_date - 7 * 26
),
sizes as (
  select cohort_week, count(*) as cohort_size from users group by 1 having count(*) >= {{ var('min_cohort') }}
),
weeks as (
  select distinct u.cohort_week, u.user_id, ((a.day - u.cohort_week) / 7)::int as weeks_since
  from users u join {{ ref('int_activity') }} a on a.user_id = u.user_id and a.day >= u.cohort_week
)
select
  s.cohort_week,
  w.weeks_since,
  s.cohort_size,
  count(distinct w.user_id) as retained,
  round(count(distinct w.user_id)::numeric / s.cohort_size, 4) as retention_rate,
  now() as built_at
from sizes s
join weeks w using (cohort_week)
where w.weeks_since between 0 and 12
  -- Only whole weeks: the current week isn't over yet for anyone.
  and s.cohort_week + 7 * (w.weeks_since + 1) <= current_date
group by s.cohort_week, w.weeks_since, s.cohort_size
order by 1, 2
