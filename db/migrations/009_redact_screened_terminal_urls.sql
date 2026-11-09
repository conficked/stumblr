PRAGMA secure_delete = ON;

UPDATE discovery_candidates
SET screen_json = json_remove(screen_json, '$.final_url', '$.screened_final_url')
WHERE json_valid(screen_json)
  AND (json_type(screen_json, '$.final_url') IS NOT NULL OR json_type(screen_json, '$.screened_final_url') IS NOT NULL);

UPDATE auto_publication_proposals
SET decisions_json = json_set(
  decisions_json,
  '$.admitted', json((
    SELECT json_group_array(json_remove(value, '$.effectiveUrl'))
    FROM json_each(decisions_json, '$.admitted')
  )),
  '$.deferred', json((
    SELECT json_group_array(json_remove(value, '$.decision.effectiveUrl'))
    FROM json_each(decisions_json, '$.deferred')
  ))
)
WHERE EXISTS (
  SELECT 1 FROM json_each(decisions_json, '$.admitted') WHERE json_type(value, '$.effectiveUrl') IS NOT NULL
) OR EXISTS (
  SELECT 1 FROM json_each(decisions_json, '$.deferred') WHERE json_type(value, '$.decision.effectiveUrl') IS NOT NULL
);
