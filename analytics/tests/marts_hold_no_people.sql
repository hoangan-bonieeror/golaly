-- Marts are aggregates: none of them has a column that identifies a person.
select table_name, column_name from information_schema.columns
where table_schema = 'analytics' and column_name in ('user_id', 'email', 'username', 'owner_id', 'actor_id', 'display_name')
