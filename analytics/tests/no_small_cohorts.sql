-- No cohort small enough to point at a person ends up in a mart.
select cohort_week as week, cohort_size from {{ ref('fct_retention_weekly') }} where cohort_size < {{ var('min_cohort') }}
union all
select signup_week, cohort_size from {{ ref('fct_activation_weekly') }} where cohort_size < {{ var('min_cohort') }}
