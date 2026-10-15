-- DAU ≤ WAU ≤ MAU on every day (7-day and 28-day windows contain the day itself).
select day, dau, wau, mau from {{ ref('fct_daily_activity') }} where not (dau <= wau and wau <= mau)
