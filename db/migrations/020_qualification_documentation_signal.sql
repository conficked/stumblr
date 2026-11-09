ALTER TABLE candidate_qualification_evidence
  ADD COLUMN documentation_signal INTEGER NOT NULL DEFAULT 0 CHECK (documentation_signal IN (0, 1));
