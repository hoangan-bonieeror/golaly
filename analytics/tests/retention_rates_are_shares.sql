-- A rate is a share of the cohort: between 0 and 1, and never more people than the cohort.
select * from {{ ref('fct_retention_weekly') }} where retention_rate < 0 or retention_rate > 1 or retained > cohort_size
