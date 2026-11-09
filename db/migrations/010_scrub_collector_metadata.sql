PRAGMA secure_delete = ON;

UPDATE discovery_candidates
SET screen_json = json_remove(screen_json, '$.x_frame_options', '$.content_security_policy', '$.server', '$.title_hint', '$.content_type', '$.error')
WHERE json_valid(screen_json) AND (
  json_type(screen_json, '$.x_frame_options') IS NOT NULL OR json_type(screen_json, '$.content_security_policy') IS NOT NULL
  OR json_type(screen_json, '$.server') IS NOT NULL OR json_type(screen_json, '$.title_hint') IS NOT NULL
  OR json_type(screen_json, '$.content_type') IS NOT NULL OR json_type(screen_json, '$.error') IS NOT NULL
);

-- Historical values cannot be verified against a newly screened title.
UPDATE discovery_candidates SET link_text = ''
WHERE source_family NOT IN ('community', 'reviewed')
  AND (link_text GLOB '*//*' OR lower(link_text) LIKE '%www.%');

UPDATE auto_publication_proposals
SET decisions_json = json_set(
  decisions_json,
  '$.admitted', json((SELECT json_group_array(
    CASE WHEN json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%'
      THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END
  ) FROM json_each(decisions_json, '$.admitted'))),
  '$.deferred', json((SELECT json_group_array(
    CASE WHEN json_extract(value, '$.decision.title') GLOB '*//*' OR lower(json_extract(value, '$.decision.title')) LIKE '%www.%'
      THEN json_set(value, '$.decision.title', 'Redacted discovery title') ELSE json(value) END
  ) FROM json_each(decisions_json, '$.deferred')))
)
WHERE EXISTS (
  SELECT 1 FROM json_each(decisions_json, '$.admitted')
  WHERE json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%'
) OR EXISTS (
  SELECT 1 FROM json_each(decisions_json, '$.deferred')
  WHERE json_extract(value, '$.decision.title') GLOB '*//*' OR lower(json_extract(value, '$.decision.title')) LIKE '%www.%'
);

UPDATE auto_publication_proposals
SET proposed_snapshot_json = json_set(proposed_snapshot_json, '$.entries', json((
  SELECT json_group_array(CASE
    WHEN json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
      AND (json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%')
    THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END)
  FROM json_each(proposed_snapshot_json, '$.entries')
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(proposed_snapshot_json, '$.entries')
  WHERE json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
    AND (json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%')
);

UPDATE auto_publication_proposals
SET removals_json = (
  SELECT json_group_array(CASE
    WHEN json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
      AND (json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%')
    THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END)
  FROM json_each(removals_json)
)
WHERE EXISTS (
  SELECT 1 FROM json_each(removals_json)
  WHERE json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
    AND (json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%')
);

UPDATE runtime_catalogue_snapshots
SET payload_json = json_set(payload_json, '$.entries', json((
  SELECT json_group_array(CASE
    WHEN json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
      AND (json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%')
    THEN json_set(value, '$.title', 'Redacted discovery title') ELSE json(value) END)
  FROM json_each(payload_json, '$.entries')
)))
WHERE json_valid(payload_json) AND EXISTS (
  SELECT 1 FROM json_each(payload_json, '$.entries')
  WHERE json_extract(value, '$.provenance.reviewer') LIKE 'stumblr-auto-policy/%'
    AND (json_extract(value, '$.title') GLOB '*//*' OR lower(json_extract(value, '$.title')) LIKE '%www.%')
);

CREATE TABLE ops_privacy_scrub_pending (id INTEGER PRIMARY KEY CHECK (id = 1));
INSERT INTO ops_privacy_scrub_pending (id) VALUES (1);
