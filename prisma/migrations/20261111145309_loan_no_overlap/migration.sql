-- Hand-written (spec 09): no two approved/out loans on one item share a day.
-- Ranges include both ends; a conflicting write fails with SQLSTATE 23P01.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "loan" ADD CONSTRAINT "loan_no_overlap"
  EXCLUDE USING gist ("itemId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE ("status" IN ('approved', 'out'));
