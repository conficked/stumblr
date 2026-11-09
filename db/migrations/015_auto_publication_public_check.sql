ALTER TABLE auto_publication_proposals ADD COLUMN public_check TEXT
  CHECK (public_check IN ('pending', 'confirmed', 'failed'));

ALTER TABLE auto_publication_proposals ADD COLUMN public_check_deadline INTEGER;
