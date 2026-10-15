{# Generic test (no dbt_utils dependency): the given columns are unique together. #}
{% test dbt_unique_combination(model, columns) %}
select {{ columns | join(', ') }}, count(*) as n
from {{ model }}
group by {{ columns | join(', ') }}
having count(*) > 1
{% endtest %}
