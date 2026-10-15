-- Every step count is between 0 and the cohort size.
select * from {{ ref('fct_activation_weekly') }}
where greatest(created_trip, planned_stop, collaborated, trip_started, marked_stop, shared) > cohort_size
