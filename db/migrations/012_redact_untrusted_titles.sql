PRAGMA secure_delete = ON;

-- Legacy collector titles have no proof of independence from their terminal URL.
UPDATE discovery_candidates SET link_text = '';
UPDATE discovery_candidates SET screen_json = json_remove(screen_json, '$.title_hint')
WHERE json_valid(screen_json) AND json_type(screen_json, '$.title_hint') IS NOT NULL;

UPDATE auto_publication_proposals
SET decisions_json = json_set(
  decisions_json,
  '$.admitted', json((SELECT json_group_array(
    CASE WHEN json_type(value, '$.title') = 'text'
      THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END
  ) FROM json_each(decisions_json, '$.admitted'))),
  '$.deferred', json((SELECT json_group_array(
    CASE WHEN json_type(value, '$.decision.title') = 'text'
      THEN json_set(value, '$.decision.title', 'Redacted discovery title') ELSE json(value) END
  ) FROM json_each(decisions_json, '$.deferred')))
)
WHERE EXISTS (
  SELECT 1 FROM json_each(decisions_json, '$.admitted')
  WHERE json_type(value, '$.title') = 'text'
) OR EXISTS (
  SELECT 1 FROM json_each(decisions_json, '$.deferred')
  WHERE json_type(value, '$.decision.title') = 'text'
);

UPDATE auto_publication_proposals
SET proposed_snapshot_json = json_set(proposed_snapshot_json, '$.entries', json((
  SELECT json_group_array(CASE
    WHEN json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
      AND (json_type(value, '$.title') = 'text')
    THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END)
  FROM json_each(proposed_snapshot_json, '$.entries')
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(proposed_snapshot_json, '$.entries')
  WHERE json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
    AND (json_type(value, '$.title') = 'text')
);

UPDATE auto_publication_proposals
SET removals_json = (
  SELECT json_group_array(CASE
    WHEN json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
      AND (json_type(value, '$.title') = 'text')
    THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END)
  FROM json_each(removals_json)
)
WHERE EXISTS (
  SELECT 1 FROM json_each(removals_json)
  WHERE json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
    AND (json_type(value, '$.title') = 'text')
);

UPDATE runtime_catalogue_snapshots
SET payload_json = json_set(payload_json, '$.entries', json((
  SELECT json_group_array(CASE
    WHEN json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
      AND (json_type(value, '$.title') = 'text')
    THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END)
  FROM json_each(payload_json, '$.entries')
)))
WHERE json_valid(payload_json) AND EXISTS (
  SELECT 1 FROM json_each(payload_json, '$.entries')
  WHERE json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
    AND (json_type(value, '$.title') = 'text')
);

INSERT OR IGNORE INTO ops_privacy_scrub_pending (id) VALUES (1);
