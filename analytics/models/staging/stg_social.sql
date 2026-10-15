-- Posts, comments and likes as one stream of "did something social".
select user_id, created_at as at, 'post' as kind from {{ source('app', 'posts') }} where deleted_at is null
union all
select user_id, created_at, 'comment' from {{ source('app', 'post_comments') }} where deleted_at is null
union all
select user_id, created_at, 'like' from {{ source('app', 'post_likes') }}
