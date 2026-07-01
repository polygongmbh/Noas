-- migrate:up
UPDATE relay_allow_jobs SET method = 'unallowpubkey' WHERE method = 'banpubkey';

ALTER TABLE relay_allow_jobs
  DROP CONSTRAINT IF EXISTS relay_allow_jobs_method_check;

ALTER TABLE relay_allow_jobs
  ADD CONSTRAINT relay_allow_jobs_method_check
    CHECK (method IN ('allowpubkey', 'unallowpubkey'));

-- migrate:down
UPDATE relay_allow_jobs SET method = 'banpubkey' WHERE method = 'unallowpubkey';

ALTER TABLE relay_allow_jobs
  DROP CONSTRAINT IF EXISTS relay_allow_jobs_method_check;

ALTER TABLE relay_allow_jobs
  ADD CONSTRAINT relay_allow_jobs_method_check
    CHECK (method IN ('allowpubkey', 'banpubkey'));
