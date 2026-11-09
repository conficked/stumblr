CREATE TRIGGER IF NOT EXISTS community_suggestion_review_queue AFTER INSERT ON community_suggestions BEGIN
 INSERT OR IGNORE INTO discovery_candidates(id,canonical_url,domain,source_id,source_family,source_url,discovered_at,status,topic_hint,topics_json,link_text,screen_json,provenance_json,updated_at)
 VALUES('community-' || NEW.id,NEW.canonical_url,NEW.domain,'community','community',NEW.canonical_url,NEW.submitted_at,'pending_review',NULL,NEW.topics_json,NEW.title,NULL,'{"review_only":true,"auto_rotation":false}',NEW.updated_at);
END;
INSERT OR IGNORE INTO discovery_candidates(id,canonical_url,domain,source_id,source_family,source_url,discovered_at,status,topic_hint,topics_json,link_text,screen_json,provenance_json,updated_at)
 SELECT 'community-' || id,canonical_url,domain,'community','community',canonical_url,submitted_at,'pending_review',NULL,topics_json,title,NULL,'{"review_only":true,"auto_rotation":false}',updated_at FROM community_suggestions;
