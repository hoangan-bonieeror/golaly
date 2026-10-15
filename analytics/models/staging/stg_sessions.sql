select user_id, created_at as signed_in_at, revoked_at
from {{ source('app', 'sessions') }}
