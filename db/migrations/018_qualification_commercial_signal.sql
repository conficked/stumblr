ALTER TABLE candidate_qualification_evidence
  ADD COLUMN commercial_signal INTEGER NOT NULL DEFAULT 0 CHECK (commercial_signal IN (0, 1));
